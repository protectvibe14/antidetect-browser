"""Profile health checker: consistency validation + best-effort network probe."""

import src._vendor  # noqa: F401  (must stay first: keeps vendored deps importable)

import inspect
import re
import threading

_IPv4_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
_NETWORK_BUDGET_S = 25
_GOTO_TIMEOUT_MS = 20000
_IP_CHECK_URL = "https://browserleaks.com/ip"


def _extract_ipv4(text):
    """Return the first syntactically valid IPv4 address in text, else None."""
    for match in _IPv4_RE.finditer(text or ""):
        if all(0 <= int(octet) <= 255 for octet in match.group(1).split(".")):
            return match.group(1)
    return None


def _validate_with(validator_cls, persona):
    """Call validator (staticmethod/classmethod or instance method) on a persona."""
    attr = inspect.getattr_static(validator_cls, "validate", None)
    if isinstance(attr, (staticmethod, classmethod)):
        return validator_cls.validate(persona)
    return validator_cls().validate(persona)


class HealthChecker:
    """Checks a profile persona for fingerprint consistency and network health.

    The consistency part always runs via the sibling ConsistencyValidator.
    The network part is best-effort: a headless launch + one page visit inside
    a hard overall timeout. Any failure there is recorded, never raised.
    """

    network_budget_s = _NETWORK_BUDGET_S

    def check(self, persona):
        """Run all health checks for a persona dict.

        Returns {'profile', 'consistency', 'network', 'score'} where
        score is 0-100 (1 decimal): 100 * passed/total from consistency,
        minus 10 when the network check did not succeed (floor 0).
        """
        results = self._run_consistency(persona)
        total = len(results)
        passed = sum(1 for r in results if isinstance(r, dict) and r.get("passed"))
        failed = total - passed
        consistency = {
            "total": total,
            "passed": passed,
            "failed": failed,
            "failures": [r for r in results
                         if not (isinstance(r, dict) and r.get("passed"))],
        }
        network = self._run_network_check(persona)
        score = (100.0 * passed / total) if total else 0.0
        if network.get("status") != "ok":
            score -= 10.0
        score = round(max(0.0, score), 1)
        name = persona.get("name") if isinstance(persona, dict) else None
        return {
            "profile": name,
            "consistency": consistency,
            "network": network,
            "score": score,
        }

    def _run_consistency(self, persona):
        """Run ConsistencyValidator.validate; synthesize a failure if unavailable."""
        try:
            from src.fingerprints.validator import ConsistencyValidator
        except Exception as exc:
            return [{"check": "validator-available", "passed": False,
                     "detail": "validator module unavailable: %s" % exc}]
        try:
            results = _validate_with(ConsistencyValidator, persona)
        except Exception as exc:
            return [{"check": "validator-run", "passed": False,
                     "detail": "validator raised: %s" % exc}]
        if not isinstance(results, list):
            return [{"check": "validator-result", "passed": False,
                     "detail": "validator returned a non-list result"}]
        return results

    def _run_network_check(self, persona):
        """Best-effort headless launch + IP page visit. Never raises."""
        try:
            from src.browser.launcher import launch_profile, browser_binary_present
        except Exception as exc:
            return {"status": "skipped",
                    "reason": ("launcher unavailable: %s" % exc)[:200]}
        try:
            if not browser_binary_present():
                return {"status": "skipped",
                        "reason": "camoufox browser binary not installed; "
                                  "run setup_browser.py first"}
        except Exception as exc:
            return {"status": "skipped",
                    "reason": ("binary check failed: %s" % exc)[:200]}
        outcome = {}
        worker = threading.Thread(
            target=self._probe_browser,
            args=(launch_profile, persona, outcome),
            daemon=True,
        )
        worker.start()
        worker.join(timeout=self.network_budget_s)
        if worker.is_alive():
            return {"status": "error",
                    "reason": "network check timed out after %ss"
                              % self.network_budget_s}
        return outcome.get("result",
                           {"status": "error",
                            "reason": "network check produced no result"})

    @staticmethod
    def _probe_browser(launch_profile, persona, outcome):
        """Worker body: launch headless, visit the IP page, record the result."""
        browser = None
        try:
            browser = launch_profile(persona, headless=True)
            page = browser.page
            page.goto(_IP_CHECK_URL, timeout=_GOTO_TIMEOUT_MS)
            html = page.content()
            outcome["result"] = {
                "status": "ok",
                "ip": _extract_ipv4(html),
                "page_reached": True,
            }
        except Exception as exc:
            outcome["result"] = {"status": "error",
                                 "reason": str(exc)[:200]}
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:
                    pass
