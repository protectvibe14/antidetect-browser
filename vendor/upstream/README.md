# Upstream full-source backups

Cold backups of the complete upstream repositories, so this project never
depends on GitHub staying up. If an upstream disappears, everything needed
to keep building is here or in `~/workspace/backups/`.

| Archive | Upstream | Date | Why kept |
|---|---|---|---|
| browserforge-main.tar.gz | github.com/daijro/browserforge | 2026-10-08 | full source of vendored package |
| fingerprint-generator-main.tar.gz | github.com/scrapfly/fingerprint-generator | 2026-10-08 | full source of vendored fpgen package |

Large files (NOT in git, kept in `~/workspace/backups/`):
| File | What | Size |
|---|---|---|
| camoufox-156.0.1-beta.36-lin.x86_64.zip | browser binary, re-zipped from installed copy | ~GBs |
| camoufox-repo-main.tar.gz | full camoufox repo (622MB — includes Firefox fork history) | ~622MB |

Also already in git under `vendor/`:
- camoufox 0.5.8 Python package (full)
- browserforge Python package (full)
- fpgen 1.3.0 Python package (full) + downloaded ML model in `vendor/fpgen/data/`

With all of the above, the project builds and runs with zero network access
to any upstream.
