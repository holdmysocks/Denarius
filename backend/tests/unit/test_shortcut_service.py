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


class ShortcutPlanTests(unittest.TestCase):
    def test_type_defaults_to_expense_and_accepts_income_in_any_case(self):
        self.assertEqual(shortcut_service.parse_type(None), TransactionType.expense)
        self.assertEqual(shortcut_service.parse_type(""), TransactionType.expense)
        self.assertEqual(shortcut_service.parse_type("Expense"), TransactionType.expense)
        self.assertEqual(shortcut_service.parse_type(" INCOME "), TransactionType.income)

    def test_plan_uses_the_matching_shortcut_settings(self):
        checking, visa = uuid.uuid4(), uuid.uuid4()
        settings = SimpleNamespace(
            expense_ask_description=True,
            expense_ask_category=False,
            expense_ask_account=True,
            expense_default_account_id=visa,
            expense_default_category_id=None,
            income_ask_description=False,
            income_ask_category=True,
            income_ask_account=False,
            income_default_account_id=checking,
            income_default_category_id=None,
            auto_category=True,
            confirmation="speak",
        )
        expense = shortcut_service.plan_for(settings, TransactionType.expense)
        income = shortcut_service.plan_for(settings, TransactionType.income)
        self.assertEqual((expense.default_account_id, expense.ask_account), (visa, True))
        self.assertEqual((income.default_account_id, income.ask_category), (checking, True))
        self.assertEqual(income.confirmation, "speak")


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
