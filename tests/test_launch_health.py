"""Regression tests for Camoufox launch health verification.

Root causes fixed:
1. Process check used wrong binary name on Windows (firefox.exe instead
   of camoufox.exe) — always reported 0 processes, hiding real failures.
2. Launch reported success (200 OK) without verifying the browser process
   was actually running and responsive.
3. 127.0.0.1 dashboard tabs from session restore were only checked on the
   first page, immediately after launch (race condition) — user saw the
   connection error in the visible window.

These tests verify the helpers without launching a real browser.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestBrowserProcessName:
    """_browser_process_name must return the real Camoufox binary name."""

    def test_returns_string(self):
        from src.browser.launcher import _browser_process_name
        name = _browser_process_name()
        assert isinstance(name, str)
        assert len(name) > 0

    def test_windows_name_is_camoufox_exe(self):
        """On Windows the binary is camoufox.exe, NOT firefox.exe.

        vendor/camoufox/pkgman.py confirms: 'win': 'camoufox.exe'.
        The old code checked firefox.exe which is always 0 on Windows.
        """
        import src.browser.launcher as launcher
        orig = os.name
        try:
            # Monkeypatch os.name to simulate Windows
            import unittest.mock as mock
            with mock.patch.object(os, "name", "nt"):
                assert launcher._browser_process_name() == "camoufox.exe"
            with mock.patch.object(os, "name", "posix"):
                # Non-Windows: should mention camoufox, not firefox
                assert "camoufox" in launcher._browser_process_name()
        finally:
            pass

    def test_count_returns_int(self):
        from src.browser.launcher import _count_browser_processes
        count = _count_browser_processes()
        assert isinstance(count, int)
        assert count >= 0


class TestVerifyBrowserHealthy:
    """_verify_browser_healthy must fail loudly on dead browsers."""

    def test_raises_when_no_process(self):
        """If no browser OS process exists, must raise RuntimeError."""
        import unittest.mock as mock
        from src.browser.launcher import _verify_browser_healthy
        fake_browser = mock.MagicMock()
        fake_browser.pages = [mock.MagicMock()]
        with mock.patch(
            "src.browser.launcher._count_browser_processes", return_value=0
        ):
            try:
                _verify_browser_healthy(fake_browser)
                assert False, "should have raised RuntimeError"
            except RuntimeError as e:
                assert "not found" in str(e).lower()

    def test_raises_when_context_dead(self):
        """If Playwright context doesn't respond, must raise."""
        import unittest.mock as mock
        from src.browser.launcher import _verify_browser_healthy
        fake_browser = mock.MagicMock()
        # Simulate dead context: .pages raises
        type(fake_browser).pages = mock.PropertyMock(
            side_effect=Exception("Target crashed")
        )
        with mock.patch(
            "src.browser.launcher._count_browser_processes", return_value=1
        ):
            try:
                _verify_browser_healthy(fake_browser)
                assert False, "should have raised RuntimeError"
            except RuntimeError as e:
                assert "not responding" in str(e).lower()

    def test_passes_when_healthy(self):
        """Healthy browser (process + responsive context) must not raise."""
        import unittest.mock as mock
        from src.browser.launcher import _verify_browser_healthy
        fake_browser = mock.MagicMock()
        fake_browser.pages = [mock.MagicMock()]
        with mock.patch(
            "src.browser.launcher._count_browser_processes", return_value=2
        ):
            # Should not raise
            _verify_browser_healthy(fake_browser)


class TestSanitizeRestoredPages:
    """_sanitize_restored_pages must handle 127.0.0.1 without data loss."""

    def test_navigates_dashboard_tab_to_blank(self):
        """A tab on 127.0.0.1 must be navigated to about:blank."""
        import unittest.mock as mock
        from src.browser.launcher import _sanitize_restored_pages
        fake_page = mock.MagicMock()
        fake_page.url = "http://127.0.0.1:8765/"
        fake_browser = mock.MagicMock()
        fake_browser.pages = [fake_page]
        with mock.patch("time.sleep"):  # skip the settle wait in tests
            result = _sanitize_restored_pages(fake_browser)
        fake_page.goto.assert_called_once_with("about:blank", timeout=5000)
        assert result is fake_page

    def test_navigates_localhost_tab_to_blank(self):
        """localhost tabs must also be sanitized."""
        import unittest.mock as mock
        from src.browser.launcher import _sanitize_restored_pages
        fake_page = mock.MagicMock()
        fake_page.url = "http://localhost:8765/dashboard"
        fake_browser = mock.MagicMock()
        fake_browser.pages = [fake_page]
        with mock.patch("time.sleep"):
            _sanitize_restored_pages(fake_browser)
        fake_page.goto.assert_called_once_with("about:blank", timeout=5000)

    def test_leaves_normal_tabs_alone(self):
        """Non-dashboard tabs must NOT be navigated away."""
        import unittest.mock as mock
        from src.browser.launcher import _sanitize_restored_pages
        fake_page = mock.MagicMock()
        fake_page.url = "https://example.com/"
        fake_browser = mock.MagicMock()
        fake_browser.pages = [fake_page]
        with mock.patch("time.sleep"):
            result = _sanitize_restored_pages(fake_browser)
        fake_page.goto.assert_not_called()
        assert result is fake_page

    def test_checks_all_pages_not_just_first(self):
        """127.0.0.1 on ANY tab (not just [0]) must be sanitized."""
        import unittest.mock as mock
        from src.browser.launcher import _sanitize_restored_pages
        good_page = mock.MagicMock()
        good_page.url = "https://example.com/"
        bad_page = mock.MagicMock()
        bad_page.url = "http://127.0.0.1:8765/"
        fake_browser = mock.MagicMock()
        fake_browser.pages = [good_page, bad_page]
        with mock.patch("time.sleep"):
            _sanitize_restored_pages(fake_browser)
        # The bad tab must be sanitized even though it's not first
        bad_page.goto.assert_called_once_with("about:blank", timeout=5000)
        # Good tab untouched
        good_page.goto.assert_not_called()

    def test_creates_page_when_none(self):
        """Empty context must get a fresh blank page."""
        import unittest.mock as mock
        from src.browser.launcher import _sanitize_restored_pages
        new_page = mock.MagicMock()
        new_page.url = "about:blank"
        fake_browser = mock.MagicMock()
        fake_browser.pages = []
        fake_browser.new_page.return_value = new_page
        with mock.patch("time.sleep"):
            result = _sanitize_restored_pages(fake_browser)
        assert result is new_page
        new_page.goto.assert_called_once_with("about:blank", timeout=5000)

    def test_no_session_restore_deletion(self):
        """Sanitizer must not delete files — surgical navigation only."""
        import inspect
        from src.browser.launcher import _sanitize_restored_pages
        src = inspect.getsource(_sanitize_restored_pages)
        assert "os.remove" not in src, "must not delete files"
        assert "shutil" not in src, "must not delete directories"
        assert "sessionstore" not in src.lower(), "must not touch sessionstore"


class TestNoDataDeletion:
    """User constraint: never delete profiles, cookies, sessions, fingerprints."""

    def test_no_clear_session_restore_function(self):
        import src.browser.launcher as launcher
        assert not hasattr(launcher, "_clear_session_restore"), \
            "must not delete session restore data"

    def test_sanitize_does_not_delete_parent_lock(self):
        import inspect
        from src.browser.launcher import _sanitize_restored_pages
        src = inspect.getsource(_sanitize_restored_pages)
        assert "parent.lock" not in src
