"""Symmetric encryption for sensitive strings at rest.

A single master Fernet key lives at ``~/.antidetect-browser/.master.key``.
The key file is created with mode ``0o600`` (owner-only read/write) on first
use. Callers mark ciphertext with the ``"enc:"`` prefix via
:func:`is_encrypted` before decrypting; plaintext values without the prefix
are treated as legacy/unencrypted and returned untouched by the caller's
decryption path.

Rotation limits (Phase 2)
-------------------------
Rotating or replacing the master key ORPHANS all previously encrypted data:
anything stored as ``"enc:" + encrypt_str(...)`` under the old key becomes
undecryptable and cannot be recovered by this module. There is NO rotation
helper in Phase 2 — key rotation must not be attempted without a dedicated
re-encryption migration. Guard ``~/.antidetect-browser/.master.key`` the
same way you guard the databases themselves.
"""

import src._vendor  # noqa: F401  (first import: keep vendored path setup)

import os

from cryptography.fernet import Fernet, InvalidToken

_HOME_DIR = os.path.join(os.path.expanduser("~"), ".antidetect-browser")
_KEY_PATH = os.path.join(_HOME_DIR, ".master.key")

#: Prefix marking a stored value as encrypted by this module.
_ENC_PREFIX = "enc:"


def get_or_create_key() -> bytes:
    """Return the master Fernet key, creating it on first use.

    The key is stored at ``~/.antidetect-browser/.master.key``. When the
    file does not exist, a fresh random key is generated, written with
    ``open(path, mode)`` after ``os.makedirs`` of the parent directory,
    then ``os.chmod(path, 0o600)`` so only the owning user can read it.
    When the file exists, its bytes are returned as-is.

    Returns:
        The 32-byte URL-safe base64-encoded Fernet key.

    Rotation limits (Phase 2): deleting or replacing this file orphans
    every previously encrypted value (no rotation helper exists in
    Phase 2). Do not rotate without a re-encryption migration.
    """
    if os.path.exists(_KEY_PATH):
        with open(_KEY_PATH, "rb") as fh:
            return fh.read().strip()
    os.makedirs(os.path.dirname(_KEY_PATH), exist_ok=True)
    key = Fernet.generate_key()
    fd = os.open(_KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(key)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        raise
    # Belt and suspenders: the fd was created with 0o600, but chmod again
    # in case the file somehow pre-existed with looser permissions (race
    # between the exists() check and os.open()).
    os.chmod(_KEY_PATH, 0o600)
    return key


def _fernet() -> Fernet:
    """Build a Fernet instance from the master key."""
    return Fernet(get_or_create_key())


def encrypt_str(plaintext: "str | None") -> "str | None":
    """Encrypt a string with the master key.

    Args:
        plaintext: The string to encrypt. ``None`` passes through.

    Returns:
        ``None`` if ``plaintext`` is ``None``; otherwise the Fernet
        token as a ``str`` (the caller is responsible for adding the
        ``"enc:"`` marker prefix when persisting).
    """
    if plaintext is None:
        return None
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_str(token: "str | None") -> "str | None":
    """Decrypt a Fernet token produced by :func:`encrypt_str`.

    Args:
        token: The token string. ``None`` passes through.

    Returns:
        The decrypted plaintext, or ``None`` if ``token`` is ``None``.

    Raises:
        cryptography.fernet.InvalidToken: If the token cannot be
            decrypted with the current master key (wrong key, tampered
            or corrupt token).
    """
    if token is None:
        return None
    return _fernet().decrypt(token.encode("ascii")).decode("utf-8")


def is_encrypted(value) -> bool:
    """Return True if ``value`` carries the ``"enc:"`` encryption marker.

    Args:
        value: Any value; non-strings return False.
    """
    return isinstance(value, str) and value.startswith(_ENC_PREFIX)
