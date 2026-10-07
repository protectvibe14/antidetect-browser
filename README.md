# Anti-Detect Browser

Stronger and more secure than AdsPower. Modular build on an open-source core
(Camoufox) for managing multiple client profiles without bans or spam flags.

## Architecture (modular — one job per module)

```
src/
  profiles/      Profile CRUD + SQLite storage (one profile = one client identity)
  fingerprints/  Consistency validator — 20+ checks, profile launches only if clean
  proxy/         Per-profile proxy assignment + health checks
  browser/       Camoufox launcher wrapper (fingerprint + proxy + humanize)
  health/        Detection-test harness (CreepJS, Pixelscan, BrowserLeaks, IPHey)
  cli.py         Command-line interface
vendor/
  camoufox/      Vendored open-source browser core (MPL-2.0)
  browserforge/  Vendored fingerprint data generator (MIT)
```

## Quick start

```bash
python setup_browser.py        # download Camoufox browser binary (once)
python -m src.cli profile create --name "client-1"
python -m src.cli profile launch --name "client-1"
python -m src.cli health check --name "client-1"
```

## Rules for contributors (agents included)

- Every module owns its files — never edit another module's files.
- Cross-module imports only through each module's public functions.
- Optimized code: no dead code, no duplicated logic, stdlib preferred.
- Every public function has a docstring.
