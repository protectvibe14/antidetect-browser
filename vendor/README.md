# Vendored open-source components

These are downloaded copies of open-source packages used by this project.
They are vendored (not pip-installed) so the project is self-contained.

| Package | Version | License | Upstream |
|---|---|---|---|
| camoufox | 0.5.8 | MPL-2.0 | https://github.com/daijro/camoufox |
| browserforge | (see METADATA) | MIT | https://github.com/daijro/browserforge |
| fpgen | 1.3.0 | (see METADATA) | https://github.com/daijro/fpgen (fingerprint ML model; model data downloads on first run via `ensure_fpgen_model()`) |
| nazak-sync (reference copy only, not executed) | de06b50 | MIT | https://github.com/wwewtech/nazak-browser-studio — `nazak/core/synchronizer.py` verbatim copy; see `nazak-sync/ATTRIBUTION.md`. Our `src/sync/` is a clean-room rewrite of its design adapted to our Playwright page objects. |

## Updating a vendored package

```bash
pip download <pkg>==<version> --no-deps -d /tmp/vendor_dl
unzip -o /tmp/vendor_dl/<pkg>-<version>-*.whl -d /tmp/vendor_dl/x
rm -rf vendor/<pkg> && cp -r /tmp/vendor_dl/x/<pkg> vendor/<pkg>
```

Then update the version table above.

## Browser binary

The Camoufox *browser binary* (~200MB) is NOT vendored in git (too large).
Run `python setup_browser.py` once — it downloads the official release
binary via the vendored package's fetch routine.
