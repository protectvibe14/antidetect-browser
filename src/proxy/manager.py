"""Proxy storage and reachability testing.

Storage choice
--------------
Proxies live in their OWN SQLite file: ``~/.antidetect-browser/proxies.db``
(table ``proxies``), separate from the profiles database
(``~/.antidetect-browser/profiles.db``). Rationale: proxy credentials are a
separate concern from profile fingerprints; a dedicated file lets a user back
up, wipe, or restrict permissions on proxy credentials independently, and
avoids any schema lock-in between the two workers. Both databases live under
the same ``~/.antidetect-browser/`` home directory.

Security note
-------------
Proxy AUTH passwords are encrypted at rest with the master Fernet key
(``~/.antidetect-browser/.master.key``, see :mod:`src.security.crypto`).
:meth:`ProxyManager.add` stores a password as ``"enc:" + encrypt_str(...)``
unless the value already carries the ``"enc:"`` marker; :meth:`get` and
:meth:`list` decrypt it (marker stripped) before returning, so callers
always see plaintext. Rows written before this change (plaintext, no
marker) are returned as-is — legacy compatibility, not a guarantee going
forward. Rotating the master key orphans all ``"enc:"`` passwords.

The store is meant for a single-user local machine; do not copy the file
to shared hosts.

The :meth:`ProxyManager.test` method only checks TCP reachability of the
proxy host:port with a 5-second timeout. It does NOT perform a proxy-protocol
handshake, so a passing test means the endpoint accepts TCP connections, not
that it is a working proxy.
"""

import os
import socket
import sqlite3
import threading

import src._vendor  # noqa: F401  (first import: keep stdlib + venv only after this)

from src import paths as _paths

#: Default proxies DB path, resolved at import time for backward
#: compatibility. ``ProxyManager()`` with no argument resolves the path at
#: call time instead, so a later ``ANTIDETECT_HOME`` change is honored.
DB_PATH = _paths.proxies_db()

_PROXY_TYPES = {"http", "https", "socks5", "socks4"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS proxies (
    name     TEXT PRIMARY KEY,
    host     TEXT NOT NULL,
    port     INTEGER NOT NULL,
    username TEXT,
    password TEXT,
    ptype    TEXT NOT NULL DEFAULT 'http'
)
"""

_COLUMNS = ("name", "host", "port", "username", "password", "ptype")


class ProxyManager:
    """SQLite-backed store for named proxy definitions.

    Proxy definitions are plain dicts::

        {'name': str, 'host': str, 'port': int,
         'username': str | None, 'password': str | None, 'type': str}

    where ``type`` is one of ``http``, ``https``, ``socks5``, ``socks4``.
    """

    def __init__(self, db_path: str = None):
        """Open (creating if needed) the proxies database.

        Args:
            db_path: Path to the SQLite file. Defaults to
                ``src.paths.proxies_db()`` (honors ``ANTIDETECT_HOME``);
                tests may pass a temporary path instead.
        """
        self._db_path = db_path or _paths.proxies_db()
        os.makedirs(os.path.dirname(os.path.abspath(self._db_path)),
                    exist_ok=True)
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.execute(_SCHEMA)
            conn.commit()

    # -- internals ------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        # Passwords come back decrypted: values stored as "enc:<token>"
        # are decrypted with the master key; legacy plaintext rows (no
        # marker) are returned as-is. InvalidToken propagates for
        # tampered / wrong-key data — that is a real failure, not noise.
        password = row["password"]
        if password is not None:
            from src.security.crypto import decrypt_str, is_encrypted

            if is_encrypted(password):
                password = decrypt_str(password[len("enc:"):])
        return {
            "name": row["name"],
            "host": row["host"],
            "port": row["port"],
            "username": row["username"],
            "password": password,
            "type": row["ptype"],
        }

    # -- public API -----------------------------------------------------
    def add(self, name, host, port, username=None, password=None,
            ptype="http") -> dict:
        """Add a named proxy definition and return it as a dict.

        Args:
            name: Unique label for the proxy.
            host: Proxy hostname or IP.
            port: Proxy port, must be 1..65535.
            username: Optional proxy-auth username.
            password: Optional proxy-auth password.
            ptype: One of ``http``, ``https``, ``socks5``, ``socks4``.

        Returns:
            ``{'name','host','port','username','password','type'}``.
            ``password`` is returned in plaintext (decrypted if stored
            encrypted).

        Raises:
            ValueError: If ``name`` already exists, ``port`` is out of
                range, or ``ptype`` is unknown.
        """
        if not isinstance(name, str) or not name.strip():
            raise ValueError("proxy name must be a non-empty string")
        if not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError(f"port must be an integer in 1..65535, got {port!r}")
        if ptype not in _PROXY_TYPES:
            raise ValueError(
                f"ptype must be one of {sorted(_PROXY_TYPES)}, got {ptype!r}"
            )
        name = name.strip()
        if password is not None:
            # Encrypt auth passwords at rest (lazy import: crypto lives in
            # another package and must not be loaded at module import).
            from src.security.crypto import encrypt_str, is_encrypted

            if not is_encrypted(password):
                password = "enc:" + encrypt_str(password)
        with self._lock, self._connect() as conn:
            if conn.execute(
                "SELECT 1 FROM proxies WHERE name = ?", (name,)
            ).fetchone():
                raise ValueError(f"proxy '{name}' already exists")
            conn.execute(
                "INSERT INTO proxies (name, host, port, username, password, ptype)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (name, host, port, username, password, ptype),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM proxies WHERE name = ?", (name,)
            ).fetchone()
        return self._row_to_dict(row)

    def get(self, name) -> dict:
        """Return the proxy definition for ``name``.

        ``password`` comes back in plaintext (decrypted if stored
        encrypted).

        Raises:
            KeyError: If no proxy with ``name`` exists.
        """
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM proxies WHERE name = ?", (name,)
            ).fetchone()
        if row is None:
            raise KeyError(f"no proxy named '{name}'")
        return self._row_to_dict(row)

    def list(self) -> list:
        """Return all stored proxy definitions, ordered by name.

        ``password`` values come back in plaintext (decrypted if stored
        encrypted).
        """
        with self._lock, self._connect() as conn:
            rows = conn.execute("SELECT * FROM proxies ORDER BY name").fetchall()
        return [self._row_to_dict(r) for r in rows]

    def delete(self, name) -> bool:
        """Delete the proxy named ``name``.

        Returns:
            True if a row was deleted, False if ``name`` did not exist.
        """
        with self._lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM proxies WHERE name = ?", (name,))
            conn.commit()
        return cur.rowcount > 0

    def test(self, name) -> bool:
        """TCP-connect to the proxy's (host, port) with a 5s timeout.

        This checks TCP reachability ONLY — it performs no proxy-protocol
        handshake, so ``True`` means the endpoint accepts connections, not
        that it is a working proxy.

        Returns:
            True if the TCP connection succeeded, False on any error.
            Never raises.
        """
        result = self.test_with_latency(name)
        return result["ok"]

    def test_with_latency(self, name) -> dict:
        """Test a proxy with real HTTP request through it.

        Verifies: TCP connect, auth, protocol, and exit IP.
        Returns:
            ``{"ok": bool, "latency_ms": int|None, "exit_ip": str|None,
               "error": str|None}``. Never raises.
        """
        import time
        try:
            proxy = self.get(name)
        except (KeyError, Exception):
            return {"ok": False, "latency_ms": None, "exit_ip": None,
                    "error": "no proxy named '%s'" % name}

        host = proxy.get("host", "")
        port = proxy.get("port", 0)
        username = proxy.get("username", "")
        password = proxy.get("password", "")
        ptype = (proxy.get("ptype") or "http").lower()

        # Build proxy URL with auth if present.
        auth = f"{username}:{password}@" if username else ""
        scheme = "socks5" if "socks" in ptype else "http"
        proxy_url = f"{scheme}://{auth}{host}:{port}"

        start = time.monotonic()
        try:
            import urllib.request
            # Use httpbin for exit IP check.
            req = urllib.request.Request("http://httpbin.org/ip",
                                         headers={"User-Agent": "Mozilla/5.0"})
            req.set_proxy(proxy_url, "http")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read().decode()
                import json as _json
                exit_ip = _json.loads(data).get("origin", "")
            latency = int((time.monotonic() - start) * 1000)
            return {"ok": True, "latency_ms": latency,
                    "exit_ip": exit_ip, "error": None}
        except Exception as exc:
            # Fallback: TCP-only check.
            try:
                sock = socket.create_connection((host, port), timeout=5)
                sock.close()
                latency = int((time.monotonic() - start) * 1000)
                return {"ok": True, "latency_ms": latency,
                        "exit_ip": None,
                        "error": "TCP ok, HTTP failed: %s" % str(exc)[:100]}
            except Exception as e2:
                return {"ok": False, "latency_ms": None, "exit_ip": None,
                        "error": str(e2)[:200]}

    def update(self, name, **fields) -> dict:
        """Update a proxy's fields (host, port, username, password, ptype).

        Raises:
            KeyError: If no proxy with ``name`` exists.
            ValueError: On invalid port or ptype.
        """
        allowed = {"host", "port", "username", "password", "ptype"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if "port" in updates:
            port = updates["port"]
            if not isinstance(port, int) or not 1 <= port <= 65535:
                raise ValueError(
                    f"port must be an integer in 1..65535, got {port!r}")
        if "ptype" in updates and updates["ptype"] not in _PROXY_TYPES:
            raise ValueError(
                f"ptype must be one of {sorted(_PROXY_TYPES)}, "
                f"got {updates['ptype']!r}")
        if "password" in updates and updates["password"] is not None:
            from src.security.crypto import encrypt_str, is_encrypted
            pw = updates["password"]
            if not is_encrypted(pw):
                updates["password"] = "enc:" + encrypt_str(pw)
        if not updates:
            return self.get(name)
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                f"UPDATE proxies SET {set_clause} WHERE name = ?",
                (*updates.values(), name),
            )
            conn.commit()
            if cur.rowcount == 0:
                raise KeyError(f"no proxy named '{name}'")
        return self.get(name)

    # -- Worker B: proxy geo-sync (additive) --------------------------
    def assign_and_sync(self, profile_name, proxy_name):
        """Assign a proxy to a profile and geo-sync the profile's persona.

        Lazily imports :class:`ProfileManager` to avoid import cycles.

        Steps:
            1. Fetch the proxy dict via :meth:`get`.
            2. Attach it to the profile via ``pm.update(profile_name,
               proxy=proxy)``.
            3. Run :meth:`GeoSync.sync_persona_to_ip` on the updated persona.
            4. Persist any geo changes (timezone/locale/geolocation).

        Args:
            profile_name: name of an existing profile.
            proxy_name: name of an existing proxy.

        Returns:
            ``{'profile', 'proxy', 'persona', 'note'}`` where ``persona``
            is the synced persona dict and ``note`` is the geo-sync status
            string from :meth:`GeoSync.sync_persona_to_ip`.

        Raises:
            KeyError: If no proxy named ``proxy_name`` or no profile named
                ``profile_name`` exists. These are caller errors, so they
                propagate (unlike best-effort network failures).
        """
        from src.profiles.manager import ProfileManager
        from src.proxy.geosync import GeoSync

        proxy = self.get(proxy_name)  # KeyError on unknown proxy
        pm = ProfileManager()
        persona = pm.update(profile_name, proxy=proxy)  # KeyError unknown profile
        synced, note = GeoSync.sync_persona_to_ip(persona)
        pm.update(
            profile_name,
            timezone=synced.get("timezone"),
            locale=synced.get("locale"),
            geolocation=synced.get("geolocation"),
        )
        return {
            "profile": profile_name,
            "proxy": proxy_name,
            "persona": synced,
            "note": note,
        }
