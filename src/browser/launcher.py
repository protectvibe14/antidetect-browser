"""Launch anti-detect browser profiles with vendored Camoufox.

This module builds Camoufox launch options from a persona dict (produced by
the profiles worker) and launches the browser. It never launches anything at
import time and never downloads anything; the Camoufox browser binary is
installed on the user's machine by ``setup_browser.py``.

Kwargs-building is factored into the pure function
:func:`build_launch_kwargs`, which is unit-testable without launching.

Design notes
------------
* Persona ``os`` values are mapped case-insensitively to camoufox's expected
  values (``'windows'`` / ``'macos'`` / ``'linux'``).
* Persona fields that describe the *generated* fingerprint (``user_agent``,
  ``platform``, ``viewport``, ``screen``, ``webgl_vendor``,
  ``webgl_renderer``, ``hardware_concurrency``, ``device_memory``,
  ``touch_points``, ``color_depth``, ``fonts``, ``canvas_seed``) are
  intentionally NOT forced into camoufox launch options: camoufox's fpgen
  builds a whole-identity fingerprint coherent with the requested OS, and
  forcing mismatched parts would break that consistency. Only the
  launch-level options listed in the contract (plus ``timezone_id``, which
  Playwright applies natively) are passed.
* Geolocation: persona ``geolocation`` is expected as a Playwright-style
  dict ``{'latitude': float, 'longitude': float}`` (``'lat'``/``'lng'``
  aliases are also accepted). When present we pass ``geoip=False`` and hand
  the dict to Playwright's ``launch_persistent_context`` natively, together
  with ``permissions=['geolocation']`` so pages see the permission as
  granted, like a real Firefox with a stored site grant. When absent but a proxy
  is set we pass ``geoip=True`` so camoufox derives locale/timezone/
  geolocation from the proxy exit IP. When neither is present, ``geoip`` is
  not passed at all.
* Persistence uses camoufox's ``persistent_context=True`` path, which
  forwards ``user_data_dir`` to Playwright's
  ``launch_persistent_context``. ``__enter__`` then returns a
  ``BrowserContext`` directly (not a ``Browser``); the wrapper exposes it
  as ``.browser`` and documents that. The profile's user-data directory
  ``~/.antidetect-browser/profiles/<name>/`` is always created, even if a
  future camoufox change ever alters the persistence path.
"""

import os
import re

import src._vendor  # noqa: F401  (must be first: enables vendored imports)

from camoufox.sync_api import Camoufox

from src import paths as _paths

_DATA_HOME = None  # resolved lazily via src.paths (honors ANTIDETECT_HOME)


def _data_home() -> str:
    """Return the data home, honoring ANTIDETECT_HOME (see src.paths)."""
    return _paths.data_dir()


def _profile_root() -> str:
    """Return the per-profile user-data root dir."""
    return _paths.profiles_dir()


# Directories safe to delete on close (cache/temp — logins preserved).
_CACHE_DIRS = (
    "cache2", "startupCache", "thumbnails", "crashes", "minidumps",
    "shader-cache", "jumpListCache", "offlineCache",
)


def _clean_profile_cache(user_data_dir: str) -> None:
    """Delete cache/temp dirs to save disk space.

    Keeps cookies.sqlite, webappsstore.sqlite (localStorage), prefs.js —
    so Gmail/logins survive. Can cut profile size from 200MB+ to ~15MB.
    Safe to call when browser is closed.
    """
    import shutil
    if not user_data_dir or not os.path.isdir(user_data_dir):
        return
    for dirname in _CACHE_DIRS:
        p = os.path.join(user_data_dir, dirname)
        if os.path.isdir(p):
            try:
                shutil.rmtree(p, ignore_errors=True)
            except Exception:
                pass
    # Also clean the default profile subdir if present.
    for entry in os.listdir(user_data_dir):
        sub = os.path.join(user_data_dir, entry)
        if os.path.isdir(sub) and entry.endswith(".default"):
            for dirname in _CACHE_DIRS:
                p = os.path.join(sub, dirname)
                if os.path.isdir(p):
                    try:
                        shutil.rmtree(p, ignore_errors=True)
                    except Exception:
                        pass


def _clear_stale_locks(user_data_dir: str) -> None:
    """Remove stale Firefox profile lock files left by crashed/killed instances.

    When a browser process dies without cleaning up (kill, crash, force-stop),
    ``parent.lock`` remains and the next launch exits immediately with code 0.
    Only removes the lock when no camoufox/firefox process is currently running
    to avoid corrupting a live profile.
    """
    lock_path = os.path.join(user_data_dir, "parent.lock")
    if not os.path.exists(lock_path):
        return
    if not os.path.exists(lock_path):
        return
    print("[LOCK] found stale lock: %s" % lock_path)
    # Check for any live browser process before touching the lock.
    try:
        if os.name == "nt":
            out = os.popen('tasklist /FI "IMAGENAME eq camoufox.exe" 2>nul').read()
            live = "camoufox.exe" in out.lower()
        else:
            out = os.popen('pgrep -f "camoufox" 2>/dev/null').read()
            live = bool(out.strip())
    except Exception as exc:
        print("[LOCK] process check failed: %s" % exc)
        live = True  # be conservative: don't touch the lock if unsure
    if live:
        print("[LOCK] browser process still running; keeping lock")
        return
    for name in ("parent.lock", "lock"):
        p = os.path.join(user_data_dir, name)
        try:
            if os.path.islink(p) or os.path.isfile(p):
                os.remove(p)
                print("[LOCK] removed stale lock: %s" % p)
        except OSError as exc:
            print("[LOCK] could not remove %s: %s" % (p, exc))

# persona['os'] -> camoufox `os` kwarg value
_OS_MAP = {
    "windows": "windows",
    "win": "windows",
    "macos": "macos",
    "mac": "macos",
    "osx": "macos",
    "darwin": "macos",
    "linux": "linux",
}

_PROXY_TYPES = {"http", "https", "socks5", "socks4"}


def _map_os(persona_os) -> str:
    """Map a persona OS string to a camoufox `os` value.

    Raises:
        ValueError: If the OS is not recognised.
    """
    if not isinstance(persona_os, str):
        raise ValueError(f"persona os must be a string, got {persona_os!r}")
    mapped = _OS_MAP.get(persona_os.strip().lower())
    if mapped is None:
        raise ValueError(
            f"unsupported persona os {persona_os!r}; "
            f"expected one of {sorted(set(_OS_MAP))}"
        )
    return mapped


def _normalize_geolocation(geo) -> dict:
    """Normalize a persona geolocation dict to Playwright format.

    Accepts ``{'latitude', 'longitude'}`` (optionally ``'accuracy'``) or the
    ``{'lat', 'lng'}`` aliases.

    Raises:
        ValueError: If the dict is missing coordinates or they are not
            numeric.
    """
    lat = geo.get("latitude", geo.get("lat"))
    lng = geo.get("longitude", geo.get("lng"))
    if lat is None or lng is None:
        raise ValueError(
            "persona geolocation needs latitude/longitude (or lat/lng), "
            f"got {geo!r}"
        )
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        raise ValueError(
            f"persona geolocation coordinates must be numeric, got {geo!r}"
        )
    result = {"latitude": lat, "longitude": lng}
    if geo.get("accuracy") is not None:
        result["accuracy"] = float(geo["accuracy"])
    return result


def _build_proxy_kwargs(proxy) -> dict:
    """Build the camoufox ``proxy``/``block_webrtc`` kwargs.

    ``proxy`` is the ProxyManager-style dict (``host``, ``port``,
    ``username``, ``password``, ``type``); returns ``{}`` when ``proxy`` is
    falsy.
    """
    if not proxy:
        return {}
    ptype = str(proxy.get("type", "http")).lower()
    if ptype not in _PROXY_TYPES:
        raise ValueError(
            f"unsupported proxy type {proxy.get('type')!r}; "
            f"expected one of {sorted(_PROXY_TYPES)}"
        )
    server = f"{ptype}://{proxy['host']}:{proxy['port']}"
    opts = {"server": server}
    if proxy.get("username"):
        opts["username"] = proxy["username"]
    if proxy.get("password") is not None:
        opts["password"] = proxy["password"]
    return {"proxy": opts, "block_webrtc": True}


def build_launch_kwargs(persona: dict, headless: bool = False) -> dict:
    """Build the keyword arguments for ``Camoufox(**kwargs)`` from a persona.

    Pure function: performs no I/O and launches nothing.

    Args:
        persona: Persona dict with keys ``name``, ``os``, ``locale``,
            ``geolocation`` (or ``None``), ``proxy`` (dict or ``None``),
            ``timezone`` (optional). Other keys are ignored (see module
            docstring).
        headless: Passed through to camoufox.

    Returns:
        Dict of kwargs ready for ``Camoufox(**kwargs)`` plus
        ``persistent_context=True`` / ``user_data_dir`` handling done by
        :func:`launch_profile`.

    Raises:
        KeyError: If ``name`` or ``os`` is missing from the persona.
        ValueError: On an unrecognised OS, proxy type, or malformed
            geolocation.
    """
    name = persona["name"]
    kwargs = {
        "headless": headless,
        "humanize": True,
        "os": [_map_os(persona["os"])],
    }

    locale = persona.get("locale")
    if locale:
        kwargs["locale"] = locale
    else:
        # Default to US English - German locale confuses users.
        kwargs["locale"] = "en-US"

    timezone = persona.get("timezone")
    if timezone:
        kwargs["timezone_id"] = timezone

    geo = persona.get("geolocation")
    proxy = persona.get("proxy")
    if geo:
        kwargs["geoip"] = False
        kwargs["geolocation"] = _normalize_geolocation(geo)
        # Playwright-native geolocation on launch_persistent_context; grant
        # the permission up front so pages see it as allowed, like a real
        # Firefox with a stored site grant.
        kwargs["permissions"] = ["geolocation"]
    elif proxy:
        kwargs["geoip"] = True
    # else: neither proxy nor geolocation -> leave geoip unset entirely

    kwargs.update(_build_proxy_kwargs(proxy))
    if not proxy:
        kwargs["block_webrtc"] = False

    kwargs["persistent_context"] = True
    kwargs["user_data_dir"] = os.path.join(_profile_root(), name)
    # NOTE: Do NOT pass our DB fingerprint dict to Camoufox.
    # Camoufox generates its own strong fingerprints internally from
    # BrowserForge. Passing a custom dict causes:
    # '"Other" fingerprints are not supported in Camoufox.'
    # Our fingerprint dict is for display/tracking in the dashboard.
    # Force Firefox to use DIRECT connection (no proxy).
    # Fixes "cannot connect to 127.0.0.1" when Windows has a stale
    # system proxy (VPN/antivirus/adblocker) configured.
    # network.proxy.type: 0=no proxy, 1=manual, 5=system (default).
    if not proxy:
        kwargs["firefox_user_prefs"] = {
            "network.proxy.type": 0,
            "network.proxy.share_proxy_settings": False,
        }
    return kwargs


class LaunchedProfile:
    """Wrapper around a launched camoufox profile.

    Attributes:
        page: The Playwright ``Page`` to drive.
        browser: The underlying launched object. For persistent launches
            (always, via :func:`launch_profile`) this is a Playwright
            ``BrowserContext``; exposed for advanced use.
    """

    def __init__(self, camoufox, browser, page):
        """Wrap an already-entered Camoufox instance.

        Args:
            camoufox: The ``Camoufox`` instance whose ``__enter__`` was
                already called (so its Playwright session is live).
            browser: What ``__enter__`` returned (a ``BrowserContext`` for
                persistent launches).
            page: A fresh ``Page`` from that context.
        """
        self._camoufox = camoufox
        self._browser = browser
        self._page = page
        self._closed = False
        self._user_data_dir = getattr(camoufox, "_user_data_dir", None)

    @property
    def page(self):
        """The Playwright page for this profile."""
        return self._page

    @property
    def browser(self):
        """The underlying launched object (a ``BrowserContext`` for
        persistent launches)."""
        return self._browser

    def close(self):
        """Close the profile cleanly: tears down the context and the
        Camoufox Playwright session. Safe to call more than once."""
        if self._closed:
            return
        self._closed = True
        try:
            self._page.close()
        except Exception:
            pass
        # Camoufox.__exit__ closes the context/browser and stops the
        # Playwright session, preventing event-loop leaks in this thread.
        self._camoufox.__exit__(None, None, None)
        # Clean cache to save disk space (keeps logins intact).
        try:
            _clean_profile_cache(self._user_data_dir)
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
        return False


def browser_binary_present() -> bool:
    """Return True if a camoufox browser build usable by the vendored library
    is installed (no download attempted).

    Uses the vendored package's own ``camoufox_path(download_if_missing=False)``
    resolution, so the answer matches what :func:`launch_profile` would find.
    """
    try:
        from camoufox.pkgman import camoufox_path
        camoufox_path(download_if_missing=False)
        return True
    except Exception:
        return False


def ensure_browser_binary() -> bool:
    """Download the camoufox browser binary if missing (auto-install).

    Returns True when a usable binary exists afterwards.
    """
    if browser_binary_present():
        return True
    try:
        from camoufox.pkgman import camoufox_path
        camoufox_path(download_if_missing=True)
    except Exception:
        pass
    # Also ensure the fpgen fingerprint model is in place.
    try:
        from camoufox.fpgen_model import ensure_fpgen_model
        ensure_fpgen_model()
    except Exception:
        pass
    return browser_binary_present()


_VERSION_JSON_NAME = "version.json"
# Matches a leading "156.0.1" in dir names like "156.0.1-beta.36-72637885".
_DIR_VERSION_RE = re.compile(r"(\d+)\.(\d+(?:\.\d+)?)")


def installed_firefox_version():
    """Return ``(major, full)`` of the installed Camoufox browser, or None.

    ``major`` is an int (e.g. ``156``) and ``full`` the version string
    (e.g. ``"156.0.1"``). Resolution:

    1. The vendored ``camoufox_path(download_if_missing=False)`` folder's
       ``version.json`` ``"version"`` field (primary; written by the
       camoufox installer).
    2. The leading ``<major>.<minor>[.<patch>]`` of the browser folder's
       own name (fallback; layout ``<ver>-<hash>``).
    3. ``None`` when the browser is not installed or the version cannot
       be determined — callers must treat this as "unknown", never as a
       failure.

    Never downloads, never raises.
    """
    import json

    try:
        from camoufox.pkgman import camoufox_path
        browser_dir = camoufox_path(download_if_missing=False)
    except Exception:
        return None
    try:
        browser_dir = os.fspath(browser_dir)
    except Exception:
        return None

    # 1) version.json
    try:
        with open(os.path.join(browser_dir, _VERSION_JSON_NAME),
                   encoding="utf-8") as fh:
            info = json.load(fh)
        full = str(info.get("version", "")).strip()
        if full:
            major = int(full.split(".")[0])
            return (major, full)
    except Exception:
        pass

    # 2) folder name fallback
    try:
        match = _DIR_VERSION_RE.match(os.path.basename(browser_dir) or "")
        if match:
            full = match.group(0)
            return (int(match.group(1)), full)
    except Exception:
        pass
    return None


def launch_profile(persona: dict, headless: bool = False) -> LaunchedProfile:
    """Launch a browser for a persona and return a :class:`LaunchedProfile`.

    Creates the per-profile user-data dir
    ``~/.antidetect-browser/profiles/<name>/`` and launches camoufox with
    ``persistent_context=True`` so cookies, storage, and logins survive
    across runs of the same profile name.

    Args:
        persona: Persona dict (see :func:`build_launch_kwargs`).
        headless: Run the browser headless.

    Returns:
        A :class:`LaunchedProfile` exposing ``.page``, ``.browser`` and
        ``.close()``.

    Raises:
        KeyError / ValueError: From :func:`build_launch_kwargs` on a bad
            persona.
        Exception: If the camoufox browser binary is missing (installed on
            the user's machine by ``setup_browser.py``) or the launch
            otherwise fails.
    """
    kwargs = build_launch_kwargs(persona, headless=headless)
    os.makedirs(kwargs["user_data_dir"], exist_ok=True)
    _clear_stale_locks(kwargs["user_data_dir"])

    camoufox = Camoufox(**kwargs)
    browser = camoufox.__enter__()
    try:
        # Reuse existing page if the persistent profile restored tabs
        # (prevents duplicate windows/tabs).
        existing = browser.pages
        if existing:
            page = existing[0]
            # Close any extra restored tabs.
            for extra in existing[1:]:
                try:
                    extra.close()
                except Exception:
                    pass
        else:
            page = browser.new_page()
        # Force blank page - prevents stale dashboard URL (127.0.0.1:8765)
        # from previous session which breaks search.
        try:
            page.goto("about:blank", timeout=5000)
        except Exception:
            pass
        # If address-bar search is broken (points to 127.0.0.1), give the
        # user a working search page. Try DuckDuckGo (less likely blocked).
        try:
            page.goto("https://duckduckgo.com", wait_until="domcontentloaded",
                      timeout=10000)
        except Exception:
            pass  # Offline - user can still type URLs.
    except Exception:
        camoufox.__exit__(None, None, None)
        raise
    lp = LaunchedProfile(camoufox, browser, page)
    lp._user_data_dir = kwargs["user_data_dir"]
    return lp


class SharedBrowser:
    """A profile launched on a caller-owned Playwright instance.

    Same ``.page`` / ``.browser`` / ``.close()`` surface as
    :class:`LaunchedProfile`, but :meth:`close` only closes this browser's
    context — the shared Playwright keeps running for the sibling browsers
    and is stopped by whoever entered it. See :func:`launch_profile_on`.
    """

    def __init__(self, browser, page):
        self._browser = browser
        self._page = page
        self._closed = False

    @property
    def page(self):
        """The Playwright page for this profile."""
        return self._page

    @property
    def browser(self):
        """The underlying launched object (a ``BrowserContext``)."""
        return self._browser

    def close(self):
        """Close this browser context only. Safe to call more than once."""
        if self._closed:
            return
        self._closed = True
        for fn in (self._page.close, self._browser.close):
            try:
                fn()
            except Exception:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
        return False


def launch_profile_on(playwright, persona: dict, headless: bool = False) -> SharedBrowser:
    """Launch a profile's browser on an already-entered Playwright instance.

    Needed when several browsers must stay open on ONE thread (e.g. the
    sync session): entering a second ``Camoufox()``/``sync_playwright()``
    while the first is still open raises Playwright's "Sync API inside the
    asyncio loop" error, because each enter leaves its event loop running.
    Sharing one Playwright avoids that entirely.

    Args:
        playwright: A ``sync_playwright()`` instance whose ``__enter__``
            was already called on this thread.
        persona: Persona dict (same as :func:`launch_profile`).
        headless: Passed through to camoufox.

    Returns:
        A :class:`SharedBrowser`. Call :meth:`SharedBrowser.close` when
        done; it does NOT stop the shared Playwright.
    """
    from camoufox.sync_api import NewBrowser

    kwargs = build_launch_kwargs(persona, headless=headless)
    os.makedirs(kwargs["user_data_dir"], exist_ok=True)
    browser = NewBrowser(playwright, **kwargs)
    try:
        existing = browser.pages
        if existing:
            page = existing[0]
            for extra in existing[1:]:
                try:
                    extra.close()
                except Exception:
                    pass
        else:
            page = browser.new_page()
    except Exception:
        try:
            browser.close()
        except Exception:
            pass
        raise
    return SharedBrowser(browser, page)
