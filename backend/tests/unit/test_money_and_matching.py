import unittest
import uuid
from decimal import Decimal
from types import SimpleNamespace

from pydantic import ValidationError

from app.models.recurring_item import RecurringType
from app.models.transaction import TransactionType
from app.schemas.transaction import TransactionCreate
from app.services.recurring_service import _types_compatible


class PositiveMoneyTests(unittest.TestCase):
    def _create(self, amount):
        return TransactionCreate(
            account_id=uuid.uuid4(), amount=amount, type="expense", date="2026-11-21"
        )

    def test_accepts_the_largest_storable_amount(self):
        self.assertEqual(self._create("9999999999999.99").amount, Decimal("9999999999999.99"))

    def test_rejects_amounts_that_overflow_numeric_15_2(self):
        with self.assertRaises(ValidationError):
            self._create("10000000000000")


class RecurringTypeCompatibilityTests(unittest.TestCase):
    def _txn(self, txn_type, hidden=False):
        return SimpleNamespace(type=txn_type, is_hidden=hidden)

    def _item(self, item_type):
        return SimpleNamespace(type=item_type)

    def test_refund_income_does_not_pay_a_subscription(self):
        self.assertFalse(
            _types_compatible(self._txn(TransactionType.income), self._item(RecurringType.subscription))
        )

    def test_expense_does_not_count_as_income(self):
        self.assertFalse(
            _types_compatible(self._txn(TransactionType.expense), self._item(RecurringType.income))
        )

    def test_matching_directions_are_compatible(self):
        self.assertTrue(
            _types_compatible(self._txn(TransactionType.expense), self._item(RecurringType.bill))
        )
        self.assertTrue(
            _types_compatible(self._txn(TransactionType.income), self._item(RecurringType.income))
        )

    def test_hidden_balance_adjustments_never_match(self):
        self.assertFalse(
            _types_compatible(self._txn(TransactionType.expense, hidden=True), self._item(RecurringType.bill))
        )
