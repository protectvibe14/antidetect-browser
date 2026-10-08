"""Command-line interface for the anti-detect browser.

Run from the repo root as::

    python -m src.cli <command> ...

Sibling modules (profiles, fingerprints, proxy, browser) are imported lazily
inside command handlers so the CLI stays usable even if one of them is
missing or broken; any such problem becomes a clean stderr message + exit 1.
"""

import src._vendor  # noqa: F401  (must stay first: keeps vendored deps importable)

import argparse
import copy
import importlib
import inspect
import json
import os
import sys
import time


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _fail(message):
    """Print a clean error to stderr and exit 1 (no tracebacks)."""
    print("error: %s" % message, file=sys.stderr)
    raise SystemExit(1)


def _instantiate(cls):
    """Instantiate a manager class; fall back to the class itself if it is
    really a namespace of staticmethods."""
    try:
        return cls()
    except TypeError:
        return cls


def _profile_manager():
    """Return a ProfileManager instance (lazy import)."""
    try:
        from src.profiles.manager import ProfileManager
    except Exception as exc:
        _fail("profiles module unavailable: %s" % exc)
    return _instantiate(ProfileManager)


def _proxy_manager():
    """Return a ProxyManager instance (lazy import)."""
    try:
        from src.proxy.manager import ProxyManager
    except Exception as exc:
        _fail("proxy module unavailable: %s" % exc)
    return _instantiate(ProxyManager)


def _launch_function():
    """Return the launch_profile callable (lazy import)."""
    try:
        from src.browser.launcher import launch_profile
    except Exception as exc:
        _fail("browser launcher unavailable: %s" % exc)
    return launch_profile


_KWARG_ALIASES = {
    "type": "ptype",      # ProxyManager.add uses ptype, not type
    "proxy_type": "type",
}


def _call_adapted(func, fields, what):
    """Call func with the subset of fields its signature accepts.

    Drops unsupported kwargs (and None values) instead of crashing on a
    sibling worker's slightly different signature; fails cleanly otherwise.
    """
    fields = {k: v for k, v in fields.items() if v is not None}
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        sig = None
    if sig is not None:
        params = sig.parameters
        if not any(p.kind == inspect.Parameter.VAR_KEYWORD
                   for p in params.values()):
            adapted = {}
            for key, value in fields.items():
                if key in params:
                    adapted[key] = value
                    continue
                alias = _KWARG_ALIASES.get(key)
                if alias and alias in params:
                    adapted[alias] = value
                # otherwise the kwarg is dropped rather than crashing
            fields = adapted
    try:
        return func(**fields)
    except TypeError as exc:
        _fail("%s failed: %s" % (what, exc))


def _get_persona_or_fail(pm, name):
    """Fetch a persona by name or exit 1 with a clean message."""
    try:
        persona = pm.get(name)
    except (KeyError, LookupError):
        _fail("profile '%s' not found" % name)
    except Exception as exc:
        lowered = str(exc).lower()
        if "not found" in lowered or "no such" in lowered:
            _fail("profile '%s' not found" % name)
        _fail("profile lookup failed: %s" % exc)
    if persona is None:
        _fail("profile '%s' not found" % name)
    if not isinstance(persona, dict):
        _fail("profile '%s' has an unexpected shape (expected persona dict)"
              % name)
    return persona


def _mask_secrets(persona):
    """Deep-copy a persona with any proxy password replaced by '***'."""
    masked = copy.deepcopy(persona)
    proxy = masked.get("proxy")
    if isinstance(proxy, dict) and "password" in proxy:
        proxy["password"] = "***"
    return masked


def _validate_persona(persona):
    """Run ConsistencyValidator.validate; return the result list.

    Returns None when the validator module is unavailable (caller decides
    how to report that) instead of failing.
    """
    try:
        from src.fingerprints.validator import ConsistencyValidator
    except Exception:
        return None
    attr = inspect.getattr_static(ConsistencyValidator, "validate", None)
    if isinstance(attr, (staticmethod, classmethod)):
        return ConsistencyValidator.validate(persona)
    return ConsistencyValidator().validate(persona)


# --------------------------------------------------------------------------- #
# profile commands
# --------------------------------------------------------------------------- #

def cmd_profile_create(args):
    """Create a profile, optionally attaching a proxy, then validate it."""
    pm = _profile_manager()
    proxy = None
    if args.proxy:
        proxm = _proxy_manager()
        try:
            proxy = proxm.get(args.proxy)
        except Exception as exc:
            _fail("proxy lookup failed: %s" % exc)
        if proxy is None:
            _fail("proxy '%s' not found" % args.proxy)
        if not isinstance(proxy, dict):
            _fail("proxy '%s' has an unexpected shape (expected dict)"
                  % args.proxy)
    persona = _call_adapted(
        pm.create,
        {"name": args.name, "os": args.os, "proxy": proxy,
         "timezone": args.timezone, "locale": args.locale},
        "profile create",
    )
    if not isinstance(persona, dict):
        _fail("profile create returned an unexpected result "
              "(expected persona dict)")
    if proxy is not None and not persona.get("proxy"):
        _attach_proxy(pm, persona, proxy)
    name = persona.get("name", args.name)
    results = _validate_persona(persona)
    if results is None:
        print("created profile '%s' "
              "(validation unavailable: validator module missing)" % name)
        return
    passed = sum(1 for r in results
                 if isinstance(r, dict) and r.get("passed"))
    print("created profile '%s' — validation: %d/%d checks passed"
          % (name, passed, len(results)))


def _attach_proxy(pm, persona, proxy):
    """Attach a proxy dict to a persona, persisting via update() when possible."""
    persona["proxy"] = proxy
    update = getattr(pm, "update", None)
    if not callable(update):
        return
    try:
        update(persona.get("name"), proxy=proxy)
    except Exception:
        pass  # in-memory persona already carries the proxy


def cmd_profile_list(args):
    """List profiles as table-ish name/os/timezone lines."""
    del args
    pm = _profile_manager()
    try:
        items = list(pm.list() or [])
    except Exception as exc:
        _fail("profile list failed: %s" % exc)
    if not items:
        print("no profiles")
        return
    print("%-24s %-8s %s" % ("NAME", "OS", "TIMEZONE"))
    for item in items:
        if isinstance(item, dict):
            name = item.get("name", "?")
            os_ = item.get("os", "?")
            tz = item.get("timezone", "?")
        else:
            name = getattr(item, "name", "?")
            os_ = getattr(item, "os", "?")
            tz = getattr(item, "timezone", "?")
        print("%-24s %-8s %s" % (name, os_, tz))


def cmd_profile_show(args):
    """Pretty-print a persona as JSON, masking any proxy password."""
    pm = _profile_manager()
    persona = _get_persona_or_fail(pm, args.name)
    print(json.dumps(_mask_secrets(persona), indent=2, default=str))


def cmd_profile_delete(args):
    """Delete a profile; report deleted vs not-found."""
    pm = _profile_manager()
    try:
        deleted = pm.delete(args.name)
    except Exception as exc:
        lowered = str(exc).lower()
        if "not found" in lowered or "no such" in lowered:
            print("profile '%s' not found" % args.name)
            return
        _fail("profile delete failed: %s" % exc)
    if deleted is False:
        print("profile '%s' not found" % args.name)
    else:
        print("deleted profile '%s'" % args.name)


def cmd_profile_launch(args):
    """Launch a profile's browser and wait for Ctrl+C, then close cleanly."""
    pm = _profile_manager()
    persona = _get_persona_or_fail(pm, args.name)
    launch_profile = _launch_function()
    try:
        browser = launch_profile(persona, headless=args.headless)
    except TypeError:
        try:
            browser = launch_profile(persona)
        except Exception as exc:
            _fail("launch failed: %s" % exc)
    except Exception as exc:
        _fail("launch failed: %s" % exc)
    print("launched, press Ctrl+C")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nclosing...")
    finally:
        try:
            browser.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# warmup commands
# --------------------------------------------------------------------------- #

def cmd_warmup(args):
    """Run a warm-up scenario on a profile (never launches anything at import)."""
    pm = _profile_manager()
    _get_persona_or_fail(pm, args.profile)
    try:
        from src.warmup import WarmupRunner
    except Exception as exc:
        _fail("warmup module unavailable: %s" % exc)
    runner = WarmupRunner(profile_manager=pm)
    result = runner.run(args.profile, scenario=args.scenario,
                        headless=args.headless)
    print(json.dumps(result, indent=2))
    if not result.get("success"):
        _fail("warmup finished with errors")


# --------------------------------------------------------------------------- #
# proxy commands
# --------------------------------------------------------------------------- #

def cmd_proxy_add(args):
    """Add a proxy entry."""
    proxm = _proxy_manager()
    _call_adapted(
        proxm.add,
        {"name": args.name, "host": args.host, "port": args.port,
         "username": args.username, "password": args.password,
         "type": args.type},
        "proxy add",
    )
    print("added proxy '%s'" % args.name)


def cmd_proxy_list(args):
    """List proxies as table-ish name/host/port/type lines."""
    del args
    proxm = _proxy_manager()
    try:
        items = list(proxm.list() or [])
    except Exception as exc:
        _fail("proxy list failed: %s" % exc)
    if not items:
        print("no proxies")
        return
    print("%-20s %-28s %-6s %s" % ("NAME", "HOST", "PORT", "TYPE"))
    for item in items:
        if isinstance(item, dict):
            name = item.get("name", "?")
            host = item.get("host", "?")
            port = item.get("port", "?")
            type_ = item.get("type", "?")
        else:
            name = getattr(item, "name", "?")
            host = getattr(item, "host", "?")
            port = getattr(item, "port", "?")
            type_ = getattr(item, "type", "?")
        print("%-20s %-28s %-6s %s" % (name, host, port, type_))


def cmd_proxy_delete(args):
    """Delete a proxy; report deleted vs not-found."""
    proxm = _proxy_manager()
    try:
        deleted = proxm.delete(args.name)
    except Exception as exc:
        lowered = str(exc).lower()
        if "not found" in lowered or "no such" in lowered:
            print("proxy '%s' not found" % args.name)
            return
        _fail("proxy delete failed: %s" % exc)
    if deleted is False:
        print("proxy '%s' not found" % args.name)
    else:
        print("deleted proxy '%s'" % args.name)


def cmd_proxy_test(args):
    """Test a proxy's reachability; print reachable True/False."""
    proxm = _proxy_manager()
    try:
        reachable = proxm.test(args.name)
    except Exception as exc:
        _fail("proxy test failed: %s" % exc)
    print("reachable: %s" % bool(reachable))


# --------------------------------------------------------------------------- #
# migrate / cookie commands (Phase 5)
# --------------------------------------------------------------------------- #

def cmd_import_from(args):
    """Import profiles from an AdsPower/GoLogin/Multilogin JSON export."""
    try:
        from src.migrate import (import_adspower, import_gologin,
                                  detect_source)
    except Exception as exc:
        _fail("migrate module unavailable: %s" % exc)
    source = (args.source or "auto").lower()
    if source == "auto":
        try:
            with open(args.file, encoding="utf-8") as fh:
                source = detect_source(json.load(fh))
        except Exception as exc:
            _fail("cannot read '%s': %s" % (args.file, exc))
    importer = import_gologin if source == "gologin" else import_adspower
    try:
        result = importer(args.file)
    except Exception as exc:
        _fail("import failed: %s" % exc)
    created = result.get("created", 0)
    skipped = result.get("skipped", []) or []
    errors = result.get("errors", []) or []
    print("imported %d profile(s) [%s]" % (created, source))
    if skipped:
        print("skipped (duplicates): %s" % ", ".join(skipped))
    for err in errors:
        if isinstance(err, dict):
            print("error [%s]: %s" % (err.get("name", "?"),
                                      err.get("error", "?")))
        else:
            print("error: %s" % err)


def cmd_cookies_export(args):
    """Export a profile's live cookie jar to a file."""
    try:
        from src.cookies.manager import export_cookies
    except Exception as exc:
        _fail("cookies module unavailable: %s" % exc)
    try:
        result = export_cookies(args.profile, fmt=args.format)
    except Exception as exc:
        _fail("cookie export failed: %s" % exc)
    if isinstance(result, dict) and result.get("error"):
        _fail(result["error"])
    print("exported cookies for '%s' to %s" % (args.profile, result))


def cmd_cookies_import(args):
    """Import cookies from a file into a profile's cookie jar."""
    try:
        from src.cookies.manager import import_cookies
    except Exception as exc:
        _fail("cookies module unavailable: %s" % exc)
    try:
        result = import_cookies(args.profile, args.file, clear=args.clear)
    except Exception as exc:
        _fail("cookie import failed: %s" % exc)
    if result.get("error"):
        _fail(result["error"])
    print("imported %d cookie(s) into '%s'%s"
          % (result.get("imported", 0), args.profile,
             " (jar cleared first)" if args.clear else ""))


# --------------------------------------------------------------------------- #
# health / setup commands
# --------------------------------------------------------------------------- #

def cmd_health_check(args):
    """Run the health checker on a profile and print score + failures."""
    pm = _profile_manager()
    persona = _get_persona_or_fail(pm, args.name)
    try:
        from src.health.checker import HealthChecker
    except Exception as exc:
        _fail("health checker unavailable: %s" % exc)
    result = HealthChecker().check(persona)
    print("health score: %s/100" % result["score"])
    failures = result["consistency"]["failures"]
    if failures:
        names = ", ".join(str(f.get("check", "?")) for f in failures
                          if isinstance(f, dict))
        print("failed checks: %s" % (names or "unknown"))
    else:
        print("failed checks: none")
    network = result["network"]
    print("network: %s" % network.get("status"))
    if network.get("status") != "ok" and network.get("reason"):
        print("network detail: %s" % network["reason"])


# --------------------------------------------------------------------------- #
# rpa commands (Phase 7)
# --------------------------------------------------------------------------- #

def _rpa_manager():
    """Return an RPAManager instance (lazy import)."""
    from src.rpa.manager import RPAManager
    return RPAManager()


def cmd_rpa_list(args):
    """List RPA recipes."""
    recipes = _rpa_manager().list()
    if not recipes:
        print("no recipes")
        return
    for r in recipes:
        print("%s  %s  (%d steps, %s)" % (
            r["id"], r["name"], r["step_count"], r.get("base_url", "")))


def cmd_rpa_run(args):
    """Run a recipe on a profile; stream logs until the job finishes."""
    mgr = _rpa_manager()
    try:
        recipe_id = mgr.resolve_id(args.recipe)
    except KeyError:
        _fail("recipe not found: %r" % args.recipe)
    job_id = mgr.run(recipe_id, args.profile, data_path=args.data,
                     headless=not args.visible)
    print("job: %s" % job_id)
    seen = 0
    try:
        while True:
            st = mgr.job_status(job_id)
            for line in st["log_tail"][seen:]:
                print(line)
            seen = len(st["log_tail"])
            pa = st.get("pending_action")
            if pa:
                q = pa.get("question") or pa.get("type") or "input required"
                print("!! operator action needed [%s]: %s" % (pa.get("type"), q))
                print("   answer via: rpa answer %s <text>  (or the dashboard)" % job_id)
            status = st["status"]
            if status in ("done", "error", "stopped"):
                summary = st.get("summary") or {}
                if "success" in summary:
                    print("summary: %d success, %d failed"
                          % (summary.get("success", 0), summary.get("failed", 0)))
                elif summary.get("error"):
                    print("summary: error: %s" % summary["error"])
                print("status: %s" % status)
                return
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nrequesting stop...", file=sys.stderr)
        mgr.stop_job(job_id)


def cmd_rpa_status(args):
    """Print a job status snapshot."""
    mgr = _rpa_manager()
    try:
        st = mgr.job_status(args.job_id)
    except KeyError:
        _fail("job not found: %r" % args.job_id)
    print("job: %s" % st["job_id"])
    print("recipe: %s (%s)" % (st.get("recipe_name") or st["recipe_id"],
                               st["recipe_id"]))
    print("profile: %s" % st["profile_name"])
    print("status: %s" % st["status"])
    summary = st.get("summary") or {}
    if "success" in summary:
        print("summary: %d success, %d failed"
              % (summary.get("success", 0), summary.get("failed", 0)))
    elif summary.get("error"):
        print("error: %s" % summary["error"])
    pa = st.get("pending_action")
    if pa:
        print("pending action: %s — %s" % (pa.get("type"),
              pa.get("question") or "(no question text)"))
    for line in st["log_tail"][-20:]:
        print("  | " + line)


def cmd_rpa_answer(args):
    """Answer a pending human-handoff question for a job."""
    mgr = _rpa_manager()
    try:
        ok = mgr.answer_action(args.job_id, args.answer)
    except KeyError:
        _fail("job not found: %r" % args.job_id)
    if not ok:
        _fail("no pending action for job %r" % args.job_id)
    print("answer sent")


def cmd_setup_check(args):
    """Verify the runtime environment; exit 0 only if everything is OK."""
    del args
    checks = []

    try:
        import src._vendor  # noqa: F401
        from camoufox.sync_api import Camoufox  # noqa: F401
        checks.append(("camoufox import (src._vendor + sync_api.Camoufox)",
                       True, ""))
    except Exception as exc:
        checks.append(("camoufox import (src._vendor + sync_api.Camoufox)",
                       False, str(exc)[:160]))

    try:
        import browserforge  # noqa: F401
        checks.append(("browserforge import", True, ""))
    except Exception as exc:
        checks.append(("browserforge import", False, str(exc)[:160]))

    try:
        from src.browser.launcher import browser_binary_present
        binary_ok = browser_binary_present()
    except Exception as exc:
        binary_ok = False
        binary_detail = str(exc)[:160]
    else:
        binary_detail = "" if binary_ok else "no usable build found"
    checks.append((
        "camoufox browser binary (run setup_browser.py if missing)",
        binary_ok,
        binary_detail,
    ))

    for module in ("src.profiles.manager", "src.fingerprints.validator",
                   "src.proxy.manager", "src.browser.launcher",
                   "src.health.checker", "src.cli"):
        try:
            importlib.import_module(module)
            checks.append(("import " + module, True, ""))
        except Exception as exc:
            checks.append(("import " + module, False, str(exc)[:160]))

    all_ok = True
    for name, ok, detail in checks:
        print("%-52s %s%s" % (name, "OK" if ok else "MISSING",
                              (" — " + detail) if (detail and not ok) else ""))
        all_ok = all_ok and ok
    raise SystemExit(0 if all_ok else 1)


# --------------------------------------------------------------------------- #
# argument parsing
# --------------------------------------------------------------------------- #

def build_parser():
    """Build the argparse parser for the CLI."""
    parser = argparse.ArgumentParser(
        prog="python -m src.cli",
        description="Anti-detect browser: profiles, proxies, health checks.")
    subs = parser.add_subparsers(dest="command", required=True)

    # profile ----------------------------------------------------------- #
    p_profile = subs.add_parser("profile", help="manage browser profiles")
    p_subs = p_profile.add_subparsers(dest="profile_cmd", required=True)

    p_create = p_subs.add_parser("create", help="create a profile")
    p_create.add_argument("--name", required=True)
    p_create.add_argument("--os", choices=["windows", "macos", "linux"],
                          default=None)
    p_create.add_argument("--proxy", default=None,
                          help="name of a proxy to attach")
    p_create.add_argument("--timezone", default=None)
    p_create.add_argument("--locale", default=None)
    p_create.set_defaults(func=cmd_profile_create)

    p_list = p_subs.add_parser("list", help="list profiles")
    p_list.set_defaults(func=cmd_profile_list)

    p_show = p_subs.add_parser("show", help="show a profile as JSON")
    p_show.add_argument("--name", required=True)
    p_show.set_defaults(func=cmd_profile_show)

    p_delete = p_subs.add_parser("delete", help="delete a profile")
    p_delete.add_argument("--name", required=True)
    p_delete.set_defaults(func=cmd_profile_delete)

    p_launch = p_subs.add_parser("launch", help="launch a profile's browser")
    p_launch.add_argument("--name", required=True)
    p_launch.add_argument("--headless", action="store_true")
    p_launch.set_defaults(func=cmd_profile_launch)

    # proxy ------------------------------------------------------------- #
    p_proxy = subs.add_parser("proxy", help="manage proxies")
    x_subs = p_proxy.add_subparsers(dest="proxy_cmd", required=True)

    x_add = x_subs.add_parser("add", help="add a proxy")
    x_add.add_argument("--name", required=True)
    x_add.add_argument("--host", required=True)
    x_add.add_argument("--port", type=int, required=True)
    x_add.add_argument("--username", default=None)
    x_add.add_argument("--password", default=None)
    x_add.add_argument("--type", choices=["http", "https", "socks5", "socks4"],
                       default="http")
    x_add.set_defaults(func=cmd_proxy_add)

    x_list = x_subs.add_parser("list", help="list proxies")
    x_list.set_defaults(func=cmd_proxy_list)

    x_delete = x_subs.add_parser("delete", help="delete a proxy")
    x_delete.add_argument("--name", required=True)
    x_delete.set_defaults(func=cmd_proxy_delete)

    x_test = x_subs.add_parser("test", help="test proxy reachability")
    x_test.add_argument("--name", required=True)
    x_test.set_defaults(func=cmd_proxy_test)

    # migrate ----------------------------------------------------------- #
    p_import = subs.add_parser(
        "import-from",
        help="import profiles from an AdsPower/GoLogin/Multilogin JSON export")
    p_import.add_argument("file", help="JSON export file (AdsPower Local API "
                                       "dump, a list, or a single profile)")
    p_import.add_argument("--source", choices=["auto", "adspower", "gologin"],
                          default="auto",
                          help="export origin (auto-detects by default)")
    p_import.set_defaults(func=cmd_import_from)

    # cookies ------------------------------------------------------------- #
    p_cookies = subs.add_parser("cookies", help="import/export profile cookies")
    p_cookies.add_argument("profile", help="profile name")
    c_subs = p_cookies.add_subparsers(dest="cookies_cmd", required=True)

    c_export = c_subs.add_parser("export", help="export a profile's cookies")
    c_export.add_argument("--format",
                          choices=["cookie-editor", "netscape", "playwright"],
                          default="cookie-editor",
                          help="output format (default: cookie-editor JSON)")
    c_export.set_defaults(func=cmd_cookies_export)

    c_import = c_subs.add_parser("import", help="import cookies into a profile")
    c_import.add_argument("file", help="cookie file (format auto-detected)")
    c_import.add_argument("--clear", action="store_true",
                          help="empty the jar before importing")
    c_import.set_defaults(func=cmd_cookies_import)

    # health ------------------------------------------------------------ #
    p_health = subs.add_parser("health", help="profile health checks")
    h_subs = p_health.add_subparsers(dest="health_cmd", required=True)
    h_check = h_subs.add_parser("check", help="run a health check on a profile")
    h_check.add_argument("--name", required=True)
    h_check.set_defaults(func=cmd_health_check)

    # warmup ------------------------------------------------------------ #
    p_warmup = subs.add_parser("warmup", help="run a warm-up scenario on a profile")
    p_warmup.add_argument("profile", help="profile name to warm up")
    p_warmup.add_argument("--scenario",
                          choices=["youtube", "ecommerce", "crypto", "finance"],
                          default="youtube",
                          help="warm-up scenario to run (default: youtube)")
    p_warmup.add_argument("--headless", dest="headless", action="store_true",
                          default=True, help="run headless (default)")
    p_warmup.add_argument("--no-headless", dest="headless", action="store_false",
                          help="run with a visible browser window")
    p_warmup.set_defaults(func=cmd_warmup)

    # rpa --------------------------------------------------------------- #
    p_rpa = subs.add_parser("rpa", help="recipe-driven browser automation")
    r_subs = p_rpa.add_subparsers(dest="rpa_cmd", required=True)
    r_list = r_subs.add_parser("list", help="list RPA recipes")
    r_list.set_defaults(func=cmd_rpa_list)
    r_run = r_subs.add_parser("run", help="run a recipe on a profile")
    r_run.add_argument("recipe", help="recipe id or name")
    r_run.add_argument("--profile", required=True, help="profile name to run on")
    r_run.add_argument("--data", default=None,
                       help="CSV/XLSX data file (optional)")
    r_run.add_argument("--visible", action="store_true",
                       help="run with a visible browser window (default: headless)")
    r_run.set_defaults(func=cmd_rpa_run)
    r_status = r_subs.add_parser("status", help="show an RPA job's status")
    r_status.add_argument("job_id", help="job id from 'rpa run'")
    r_status.set_defaults(func=cmd_rpa_status)
    r_answer = r_subs.add_parser("answer",
                                 help="answer a pending human-handoff question")
    r_answer.add_argument("job_id", help="job id from 'rpa run'")
    r_answer.add_argument("answer", help="answer text for the pending action")
    r_answer.set_defaults(func=cmd_rpa_answer)

    # setup ------------------------------------------------------------- #
    p_setup = subs.add_parser("setup", help="environment checks")
    s_subs = p_setup.add_subparsers(dest="setup_cmd", required=True)
    s_check = s_subs.add_parser("check", help="verify the environment")
    s_check.set_defaults(func=cmd_setup_check)

    return parser


def main(argv=None):
    """Parse argv and dispatch to the selected subcommand.

    Returns a process exit code; user-facing errors print to stderr
    without tracebacks.
    """
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except SystemExit:
        raise
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130
    except Exception as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
