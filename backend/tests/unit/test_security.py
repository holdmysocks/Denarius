import unittest
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_settings
from app.utils.security import create_access_token, decode_access_token, hash_password, verify_password

# Hashes produced by passlib's CryptContext(schemes=["bcrypt"]) before the
# switch to the bcrypt library, so existing accounts keep signing in.
PASSLIB_HASH = "$2b$12$GnswDaYrQNpaTLNVZefBO.Ti9Jy2ZwFMVSTgN4R8aG/5QdIWbabta"
PASSLIB_LONG_HASH = "$2b$12$kON4MXvFzxO/3Opg/AjxTOdeekBDs4HeVhTS6LtBz3eqD78XTkNHm"  # "x" * 100


class PasswordHashTests(unittest.TestCase):
    def test_verifies_hashes_created_by_passlib(self):
        self.assertTrue(verify_password("correct horse battery staple", PASSLIB_HASH))
        self.assertFalse(verify_password("wrong", PASSLIB_HASH))

    def test_long_passwords_match_passlib_truncation(self):
        self.assertTrue(verify_password("x" * 100, PASSLIB_LONG_HASH))
        self.assertTrue(verify_password("x" * 72, PASSLIB_LONG_HASH))

    def test_round_trip_and_malformed_hash(self):
        hashed = hash_password("s3cret-pass")
        self.assertTrue(hashed.startswith("$2b$12$"))
        self.assertTrue(verify_password("s3cret-pass", hashed))
        self.assertFalse(verify_password("s3cret-pass", "not-a-bcrypt-hash"))


class AccessTokenTests(unittest.TestCase):
    def test_round_trip(self):
        payload = decode_access_token(create_access_token({"sub": "abc", "role": "member"}))
        self.assertEqual(payload["sub"], "abc")
        self.assertEqual(payload["type"], "access")

    def test_expired_and_tampered_tokens_are_rejected(self):
        secret = get_settings().JWT_SECRET
        expired = jwt.encode(
            {"sub": "abc", "type": "access", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
            secret,
            algorithm="HS256",
        )
        with self.assertRaises(jwt.PyJWTError):
            decode_access_token(expired)
        with self.assertRaises(jwt.PyJWTError):
            decode_access_token(create_access_token({"sub": "abc"}) + "x")
        forged = jwt.encode({"sub": "abc", "type": "access"}, "another-secret-of-32-chars-minimum!", algorithm="HS256")
        with self.assertRaises(jwt.PyJWTError):
            decode_access_token(forged)
