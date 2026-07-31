import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import uuid

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.dml import Delete, Update

from app.config import Settings
from app.models.user import UserRole
from app.routers.system import health
from app.services import auth_service


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class AuthServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_refresh_token_cleanup_is_bounded(self):
        db = SimpleNamespace(execute=AsyncMock())

        await auth_service._cleanup_stale_refresh_tokens(db, batch_size=25)

        statement = db.execute.await_args.args[0]
        self.assertIsInstance(statement, Delete)
        statement_text = str(statement)
        self.assertIn("refresh_tokens.expires_at <=", statement_text)
        self.assertIn("refresh_tokens.revoked_at IS NOT NULL", statement_text)
        self.assertIn("LIMIT", statement_text)

    async def test_refresh_consumes_token_with_one_conditional_update(self):
        user_id = uuid.uuid4()
        user = SimpleNamespace(id=user_id, username="alice", role=UserRole.member)
        db = SimpleNamespace(
            execute=AsyncMock(side_effect=[_ScalarResult(user_id), _ScalarResult(user)]),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with patch.object(
            auth_service,
            "_issue_tokens",
            AsyncMock(return_value=("access", "replacement")),
        ):
            _, access, refresh = await auth_service.refresh_tokens("original", db)

        consume_statement = db.execute.await_args_list[0].args[0]
        self.assertIsInstance(consume_statement, Update)
        statement_text = str(consume_statement)
        self.assertIn("refresh_tokens.revoked_at IS NULL", statement_text)
        self.assertIn("refresh_tokens.expires_at >", statement_text)
        self.assertIn("RETURNING refresh_tokens.user_id", statement_text)
        self.assertEqual((access, refresh), ("access", "replacement"))
        db.commit.assert_awaited_once()
        db.rollback.assert_not_awaited()

    async def test_replayed_refresh_is_rejected_and_rolled_back(self):
        db = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(None)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with self.assertRaises(HTTPException) as caught:
            await auth_service.refresh_tokens("already-consumed", db)

        self.assertEqual(caught.exception.status_code, 401)
        db.rollback.assert_awaited_once()
        db.commit.assert_not_awaited()

    async def test_competing_admin_claim_returns_conflict(self):
        db = SimpleNamespace(
            execute=AsyncMock(return_value=SimpleNamespace(scalar=lambda: 0)),
            commit=AsyncMock(side_effect=IntegrityError("admin conflict", {}, Exception())),
            rollback=AsyncMock(),
            refresh=AsyncMock(),
        )
        user = SimpleNamespace(role=UserRole.member)

        with self.assertRaises(HTTPException) as caught:
            await auth_service.claim_admin(user, db)

        self.assertEqual(caught.exception.status_code, 409)
        db.rollback.assert_awaited_once()
        db.refresh.assert_not_awaited()


class HealthTests(unittest.IsolatedAsyncioTestCase):
    async def test_database_failure_returns_service_unavailable(self):
        db = SimpleNamespace(execute=AsyncMock(side_effect=RuntimeError("database unavailable")))

        with self.assertRaises(HTTPException) as caught:
            await health(db)

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail["db"], "error")


class SettingsTests(unittest.TestCase):
    def test_jwt_secret_requires_at_least_32_characters(self):
        with self.assertRaises(ValidationError):
            Settings(DATABASE_URL="postgresql+asyncpg://db/test", JWT_SECRET="x" * 31)

        settings = Settings(DATABASE_URL="postgresql+asyncpg://db/test", JWT_SECRET="x" * 32)
        self.assertEqual(len(settings.JWT_SECRET), 32)


if __name__ == "__main__":
    unittest.main()
