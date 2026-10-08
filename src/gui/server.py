import src._vendor  # noqa: F401  -- makes vendored deps importable; must stay first

"""Local HTTP control server for the anti-detect browser GUI.

Exposes profile management, launching, health checks, proxies and bulk
import over a JSON REST API, and serves the frontend static bundle at ``/``.

Run from the repo root with::

    python -m src.gui.server

which starts uvicorn on ``127.0.0.1:8765``.
"""

import datetime
import os
import threading

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.bulk.importer import bulk_import
from src.browser.launcher import launch_profile, browser_binary_present
from src.health.checker import HealthChecker
from src.profiles.manager import ProfileManager
from src.proxy.manager import ProxyManager
from src.sync import SyncManager

_VALID_OS = ("windows", "macos", "linux")

# ---------------------------------------------------------------------------
# Shared (module-level) state
# ---------------------------------------------------------------------------
_profile_manager = ProfileManager()
_proxy_manager = ProxyManager()

# running[name] = {"status": "starting"|"running"|"stopped",
#                  "launched": LaunchedProfile|None,
#                  "error": str|None}
_running = {}
_running_lock = threading.Lock()

# last_used[name] = ISO-8601 UTC timestamp of the last successful launch
_last_used = {}

# Sync sessions live here so the endpoints stay thin; the manager owns its
# threads and closes session browsers on stop.
_sync_manager = SyncManager(persona_getter=_profile_manager.get)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now_iso():
    """Current UTC time as an ISO-8601 string."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _profile_view(persona):
    """Shape a persona dict for the public /api/profiles contract."""
    with _running_lock:
        entry = _running.get(persona["name"])
        status = entry["status"] if entry is not None else "stopped"
        last_used = _last_used.get(persona["name"])
    proxy = persona.get("proxy") or {}
    if proxy.get("name"):
        proxy_label = proxy["name"]
    elif proxy.get("host") and proxy.get("port") is not None:
        proxy_label = "%s:%s" % (proxy["host"], proxy["port"])
    else:
        proxy_label = None
    return {
        "name": persona.get("name"),
        "os": persona.get("os"),
        "client_tag": persona.get("client_tag"),
        "proxy_label": proxy_label,
        "status": status,
        "last_used": last_used,
    }


def _launch_worker(name, persona):
    """Daemon-thread body: launch the browser, then record the outcome."""
    try:
        launched = launch_profile(persona, headless=False)
    except Exception as exc:
        with _running_lock:
            entry = _running.get(name)
            if entry is not None and entry["status"] == "starting":
                entry["status"] = "stopped"
                entry["launched"] = None
                entry["error"] = str(exc)[:500]
        return
    with _running_lock:
        entry = _running.get(name)
        if entry is None or entry.get("status") != "starting":
            # The profile was stopped (or removed) while the browser was
            # launching; do not leak a window the user cannot see in the GUI.
            still_wanted = False
        else:
            still_wanted = True
            entry["status"] = "running"
            entry["launched"] = launched
            _last_used[name] = _now_iso()
    if not still_wanted:
        try:
            launched.close()
        except Exception:
            pass


def _close_all_running():
    """Best-effort close of every launched browser (shutdown path)."""
    with _running_lock:
        entries = list(_running.values())
        _running.clear()
    for entry in entries:
        launched = entry.get("launched") if entry else None
        if launched is not None:
            try:
                launched.close()
            except Exception:
                pass
        if entry is not None:
            entry["status"] = "stopped"
            entry["launched"] = None
    # Sync sessions own their browsers on their own threads; stop them too.
    try:
        for session in _sync_manager.status().get("sessions", []):
            try:
                _sync_manager.stop(session["session_id"])
            except Exception:
                pass
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class ProfileCreate(BaseModel):
    """Body for POST /api/profiles."""

    name: str
    os: str = "windows"
    proxy_name: str | None = None
    client_tag: str | None = None


class SyncStart(BaseModel):
    """Body for POST /api/sync/start."""

    master: str
    followers: list[str] = []
    headless: bool = True
    typing: bool = True


class CookieExportRequest(BaseModel):
    """Body for POST /api/cookies/export."""

    profile: str
    fmt: str = "cookie-editor"  # cookie-editor | netscape | playwright


class SyncStop(BaseModel):
    """Body for POST /api/sync/stop."""

    session_id: str


class SyncTyping(BaseModel):
    """Body for POST /api/sync/typing."""

    session_id: str
    enabled: bool


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------
def create_app() -> FastAPI:
    """Build and return the GUI backend FastAPI application."""
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(app):
        yield
        _close_all_running()

    app = FastAPI(title="Anti-Detect Browser GUI backend", lifespan=lifespan)

    # -- error handlers: every error is JSON {"error": "message"} ----------
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request, exc):
        return JSONResponse(
            {"error": str(exc.detail)},
            status_code=exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request, exc):
        return JSONResponse(
            {"error": "invalid request: %s" % exc},
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(request, exc):
        return JSONResponse(
            {"error": "internal error: %s" % exc},
            status_code=500,
        )

    # -- profiles ---------------------------------------------------------
    @app.get("/api/profiles")
    def list_profiles():
        """List all profiles with their runtime status."""
        return {"profiles": [_profile_view(p) for p in
                             _profile_manager.list()]}

    @app.post("/api/profiles", status_code=201)
    def create_profile(body: ProfileCreate):
        """Create a new profile; optional proxy attached by name."""
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(400, "name is required and must be "
                                     "non-empty")
        if body.os not in _VALID_OS:
            raise HTTPException(
                400, "os must be one of %s" % (list(_VALID_OS),))
        try:
            _profile_manager.get(name)
        except KeyError:
            pass
        else:
            raise HTTPException(409, "profile '%s' already exists" % name)
        proxy = None
        if body.proxy_name:
            try:
                proxy = _proxy_manager.get(body.proxy_name)
            except KeyError:
                raise HTTPException(
                    400, "unknown proxy_name '%s'" % body.proxy_name)
        try:
            persona = _profile_manager.create(
                name, os=body.os, proxy=proxy,
                client_tag=body.client_tag)
        except ValueError as exc:
            # Race-safe: re-check existence to distinguish a duplicate
            # (409) from a bad argument (400).
            try:
                _profile_manager.get(name)
            except KeyError:
                raise HTTPException(400, str(exc))
            raise HTTPException(409, "profile '%s' already exists" % name)
        return {"profile": _profile_view(persona)}

    @app.delete("/api/profiles/{name}")
    def delete_profile(name: str):
        """Delete a profile; refuses while the profile is running/starting."""
        with _running_lock:
            entry = _running.get(name)
            if entry is not None and entry["status"] in ("running",
                                                         "starting"):
                raise HTTPException(
                    409, "profile '%s' is %s; stop it before deleting"
                    % (name, entry["status"]))
        try:
            _profile_manager.get(name)
        except KeyError:
            raise HTTPException(404, "no profile named '%s'" % name)
        _profile_manager.delete(name)
        return {"deleted": True}

    @app.post("/api/profiles/{name}/launch")
    def launch_profile_endpoint(name: str):
        """Start the profile's browser (visible window) in a daemon thread."""
        try:
            persona = _profile_manager.get(name)
        except KeyError:
            raise HTTPException(404, "no profile named '%s'" % name)
        with _running_lock:
            entry = _running.get(name)
            if entry is not None and entry["status"] in ("running",
                                                         "starting"):
                raise HTTPException(
                    409, "profile '%s' is already %s"
                    % (name, entry["status"]))
            # Guard BEFORE spawning the thread: launch_profile hands a
            # missing binary to camoufox, which would kick off a multi-GB
            # browser download instead of failing fast.
            try:
                binary_ok = browser_binary_present()
            except Exception:
                binary_ok = False
            if not binary_ok:
                raise HTTPException(
                    409, "camoufox browser binary not installed; "
                         "run setup_browser.py first")
            _running[name] = {"status": "starting", "launched": None,
                              "error": None}
        threading.Thread(target=_launch_worker, args=(name, persona),
                         daemon=True).start()
        return {"status": "starting"}

    @app.post("/api/profiles/{name}/stop")
    def stop_profile(name: str):
        """Stop a running profile's browser; never raises out of close()."""
        with _running_lock:
            entry = _running.get(name)
            if entry is None or entry["status"] not in ("running",
                                                        "starting"):
                raise HTTPException(
                    404, "profile '%s' is not running" % name)
            launched = entry.get("launched")
            entry["status"] = "stopped"
            entry["launched"] = None
        if launched is not None:
            try:
                launched.close()
            except Exception:
                pass
        return {"status": "stopped"}

    @app.get("/api/profiles/{name}/health")
    def profile_health(name: str):
        """Run the health checker for a profile persona."""
        try:
            persona = _profile_manager.get(name)
        except KeyError:
            raise HTTPException(404, "no profile named '%s'" % name)
        return HealthChecker().check(persona)

    # -- synchronizer -------------------------------------------------
    @app.post("/api/sync/start", status_code=201)
    def sync_start(body: SyncStart):
        """Start a sync session mirroring the master onto the followers.

        Refuses (409) when any named profile is already running in the GUI:
        a sync session launches its own browser instances, and two
        instances on one profile directory would collide on the browser
        lock.
        """
        names = [body.master, *(body.followers or [])]
        with _running_lock:
            busy = [n for n in names
                    if _running.get(n, {}).get("status")
                    in ("running", "starting")]
        if busy:
            raise HTTPException(
                409, "profiles already running: %s; stop them first"
                % ", ".join(busy))
        try:
            session_id = _sync_manager.create(
                body.master, body.followers or [],
                headless=body.headless, typing_enabled=body.typing)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"session_id": session_id,
                "status": _sync_manager.status(session_id)}

    @app.post("/api/sync/stop")
    def sync_stop(body: SyncStop):
        """Stop a sync session and close its browsers."""
        try:
            final = _sync_manager.stop(body.session_id)
        except KeyError:
            raise HTTPException(
                404, "no sync session '%s'" % body.session_id)
        return {"stopped": True, "status": final}

    @app.get("/api/sync/status")
    def sync_status(session_id: str | None = None):
        """Status of one sync session, or all sessions when omitted."""
        try:
            return _sync_manager.status(session_id)
        except KeyError:
            raise HTTPException(
                404, "no sync session '%s'" % session_id)

    @app.post("/api/sync/typing")
    def sync_typing(body: SyncTyping):
        """Enable/disable keystroke mirroring for a running session."""
        try:
            return _sync_manager.set_typing(body.session_id, body.enabled)
        except KeyError:
            raise HTTPException(
                404, "no sync session '%s'" % body.session_id)

    # -- proxies ----------------------------------------------------------
    @app.get("/api/proxies")
    def list_proxies():
        """List proxies; passwords are never exposed."""
        return {"proxies": [
            {"name": p["name"], "host": p["host"], "port": p["port"],
             "type": p["type"]}
            for p in _proxy_manager.list()
        ]}

    # -- bulk import ------------------------------------------------------
    @app.post("/api/bulk/import")
    async def bulk_import_endpoint(file: UploadFile = File(...),
                                  client_tag: str | None = Form(None)):
        """Import profiles from an uploaded CSV file.

        ``file`` is the CSV upload; ``client_tag`` (optional form field) is
        the default tag for rows that leave the column blank.
        """
        data = await file.read()
        tmp_path = None
        try:
            import tempfile
            fd, tmp_path = tempfile.mkstemp(suffix=".csv",
                                            prefix="gui-import-")
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            result = bulk_import(tmp_path,
                                 client_tag=client_tag or None)
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        return {"created": result.get("created", 0),
                "skipped": result.get("skipped", []),
                "errors": result.get("errors", [])}

    # -- migration: import profiles from other anti-detect browsers -------
    @app.post("/api/migrate/adspower")
    async def migrate_adspower_endpoint(file: UploadFile = File(...),
                                       source: str | None = Form(None)):
        """Import profiles from an AdsPower/GoLogin/Multilogin JSON export.

        ``file`` is the JSON upload (a dump of the AdsPower Local API
        ``{"data": {"list": [...]}}`` response, a plain list, or a
        hand-built file). ``source`` (optional form field, ``"adspower"``
        or ``"gologin"``) selects the importer; both share the same
        tolerant field aliasing, the choice only documents intent.
        """
        from src.migrate import import_adspower, import_gologin
        data = await file.read()
        tmp_path = None
        try:
            import tempfile
            fd, tmp_path = tempfile.mkstemp(suffix=".json",
                                            prefix="gui-migrate-")
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            importer = (import_gologin
                        if (source or "").lower() == "gologin"
                        else import_adspower)
            result = importer(tmp_path)
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        return {"created": result.get("created", 0),
                "skipped": result.get("skipped", []),
                "errors": result.get("errors", [])}

    # -- cookies: import/export a profile's live cookie jar ---------------
    @app.post("/api/cookies/export")
    def cookies_export_endpoint(body: CookieExportRequest):
        """Export a profile's cookies; needs the Camoufox binary.

        Body: ``{"profile": name, "fmt": "cookie-editor"|"netscape"|
        "playwright"}``. Returns ``{"path": ...}``; the profile is launched
        headless, so this refuses (409) when the browser binary is missing.
        """
        from src.cookies.manager import export_cookies
        result = export_cookies(body.profile, fmt=body.fmt or "cookie-editor")
        if isinstance(result, dict) and result.get("error"):
            raise HTTPException(409, result["error"])
        return {"path": result}

    @app.post("/api/cookies/import")
    async def cookies_import_endpoint(file: UploadFile = File(...),
                                      profile: str = Form(...),
                                      clear: bool = Form(False)):
        """Import cookies into a profile's cookie jar.

        ``file`` is the cookie file (Cookie-Editor JSON, Playwright
        storage-state, or Netscape ``cookies.txt`` — auto-detected);
        ``profile`` names the target profile; ``clear`` (form bool)
        empties the jar first when true.
        """
        from src.cookies.manager import import_cookies
        data = await file.read()
        tmp_path = None
        try:
            import tempfile
            fd, tmp_path = tempfile.mkstemp(suffix=".cookies",
                                            prefix="gui-cookies-")
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            result = import_cookies(profile, tmp_path, clear=bool(clear))
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        if result.get("error"):
            raise HTTPException(409, result["error"])
        return {"imported": result.get("imported", 0)}

    # -- frontend statics -------------------------------------------------
    # Mounted LAST so /api/* routes always win. The directory may be empty
    # (frontend worker creates the bundle later); makedirs keeps StaticFiles
    # from failing on a missing directory.
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "static")
    os.makedirs(static_dir, exist_ok=True)
    app.mount("/", StaticFiles(directory=static_dir, html=True),
              name="static")

    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=8765)
