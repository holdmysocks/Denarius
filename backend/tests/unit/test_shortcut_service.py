import unittest
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.models.transaction import TransactionType
from app.services import shortcut_service


class _Rows:
    def __init__(self, values):
        self.values = values

    def scalars(self):
        return iter(self.values)


class ParseAmountTests(unittest.TestCase):
    def test_accepts_numbers_and_dictated_text(self):
        cases = {
            12.5: "12.50",
            "12.50": "12.50",
            "$1,234.56": "1234.56",
            "12,50": "12.50",
            " 8 dollars ": "8.00",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(shortcut_service.parse_amount(raw), Decimal(expected))

    def test_rejects_missing_or_zero_amounts(self):
        for raw in (None, "", "lunch", "0", True):
            with self.subTest(raw=raw), self.assertRaises(HTTPException):
                shortcut_service.parse_amount(raw)


class ApiKeyTests(unittest.TestCase):
    def test_generated_key_has_prefix_and_is_stored_hashed(self):
        raw, prefix, key_hash = shortcut_service.generate_api_key()
        self.assertTrue(raw.startswith("dnr_"))
        self.assertTrue(raw.startswith(prefix))
        self.assertNotIn(raw, key_hash)
        self.assertEqual(len(key_hash), 64)


class AuthenticateApiKeyTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_non_api_key_bearer_tokens_without_querying(self):
        db = SimpleNamespace(scalar=AsyncMock())
        for header in (None, "", "Bearer eyJhbGciOi.jwt.token", "Basic dnr_abc"):
            with self.subTest(header=header), self.assertRaises(HTTPException) as caught:
                await shortcut_service.authenticate_api_key(header, db)
            self.assertEqual(caught.exception.status_code, 401)
        db.scalar.assert_not_awaited()


class GuessCategoryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dining = SimpleNamespace(id=uuid.uuid4(), name="Dining Out")
        self.gas = SimpleNamespace(id=uuid.uuid4(), name="Gas")
        self.categories = [self.dining, self.gas]

    async def test_prefers_category_from_matching_past_transaction(self):
        db = SimpleNamespace(execute=AsyncMock(return_value=_Rows([self.dining.id])))
        guessed = await shortcut_service.guess_category(
            "Lunch", TransactionType.expense, self.categories, db
        )
        self.assertIs(guessed, self.dining)

    async def test_falls_back_to_category_named_in_description(self):
        db = SimpleNamespace(execute=AsyncMock(return_value=_Rows([])))
        guessed = await shortcut_service.guess_category(
            "gas at costco", TransactionType.expense, self.categories, db
        )
        self.assertIs(guessed, self.gas)

    async def test_returns_none_when_nothing_matches(self):
        db = SimpleNamespace(execute=AsyncMock(return_value=_Rows([])))
        guessed = await shortcut_service.guess_category(
            "gasoline", TransactionType.expense, self.categories, db
        )
        self.assertIsNone(guessed)


if __name__ == "__main__":
    unittest.main()
