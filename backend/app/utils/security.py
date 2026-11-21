import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.config import get_settings

settings = get_settings()

# bcrypt only reads the first 72 bytes of a password. passlib (which Denarius used
# previously) silently truncated to that length, so truncate the same way to keep
# verifying every existing hash, and because bcrypt>=5 raises on longer input.
_BCRYPT_MAX_BYTES = 72
BCRYPT_ROUNDS = 12


def _password_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_password_bytes(plain), hashed.encode("ascii"))
    except (ValueError, TypeError):
        # Malformed or non-bcrypt hash: treat as a failed login, not a 500.
        return False


def create_access_token(data: dict[str, Any]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {**data, "exp": expire, "iat": datetime.now(timezone.utc), "type": "access"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_refresh_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
