import asyncio
from datetime import date
from decimal import Decimal
import inspect
from types import SimpleNamespace
import unittest
import uuid

from fastapi import HTTPException
from pydantic import ValidationError

from app.models.account import Account, AccountType
from app.models.category import CategoryType
from app.models.recurring_item import RecurringFrequency, RecurringItem, RecurringType
from app.models.transaction import Transaction, TransactionType
from app.routers.recurring import _validate_recurring_references
from app.routers.transactions import (
    _effective_transaction_type,
    _validate_transaction_references,
    router as transactions_router,
    update_transaction,
)
from app.schemas.account import AccountUpdate
from app.schemas.budget import BudgetCreate, MonthlyTargetSet
from app.schemas.category import CategoryUpdate
from app.schemas.mortgage import MortgageCreate, MortgagePaymentCreate, MortgageUpdate
from app.schemas.recurring_item import MarkPaidRequest, RecurringCreate, RecurringUpdate
from app.schemas.transaction import TransactionCreate, TransactionUpdate
from app.services.recurring_service import detach_recurring, mark_paid


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _DetachDatabase:
    def __init__(self, item, remaining_payment):
        self.item = item
        self.remaining_payment = remaining_payment
        self.statement = None

    async def get(self, model, key):
        if model is RecurringItem and key == self.item.id:
            return self.item
        return None

    async def execute(self, statement):
        self.statement = statement
        return _ScalarResult(self.remaining_payment)


class _SequenceDatabase:
    def __init__(self, *values):
        self.values = list(values)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _ScalarResult(self.values.pop(0))


class _MarkPaidDatabase:
    def __init__(self, account):
        self.account = account
        self.added = []
        self.commit_count = 0

    async def get(self, model, key):
        if model is Account and key == self.account.id:
            return self.account
        return None

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        for value in self.added:
            if isinstance(value, Transaction) and value.id is None:
                value.id = uuid.uuid4()

    async def commit(self):
        self.commit_count += 1

    async def refresh(self, value):
        return None


def _recurring_item() -> RecurringItem:
    return RecurringItem(
        id=uuid.uuid4(),
        name="Weekly bill",
        account_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        amount=Decimal("25.00"),
        type=RecurringType.bill,
        frequency=RecurringFrequency.weekly,
        next_due_date=date(2026, 2, 5),
        last_paid_date=date(2026, 1, 29),
        last_paid_amount=Decimal("25.00"),
    )


def _transaction(item_id: uuid.UUID, payment_date: date) -> Transaction:
    return Transaction(
        id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        recurring_item_id=item_id,
        amount=Decimal("25.00"),
        type=TransactionType.expense,
        date=payment_date,
    )


class RecurringDetachTests(unittest.TestCase):
    def test_mark_paid_uses_one_commit_per_payment_path(self):
        source = inspect.getsource(mark_paid)

        # One commit in the mortgage branch and one in the normal branch.
        self.assertEqual(source.count("await db.commit()"), 2)
        self.assertIn("await db.flush()", source)

    def test_mark_paid_income_increases_existing_account_balance(self):
        account = Account(
            id=uuid.uuid4(),
            name="Checking",
            type=AccountType.checking,
            current_balance=Decimal("100.00"),
            initial_balance=Decimal("100.00"),
            is_active=True,
        )
        item = RecurringItem(
            id=uuid.uuid4(),
            name="Paycheck",
            account_id=account.id,
            created_by=uuid.uuid4(),
            amount=Decimal("50.00"),
            type=RecurringType.income,
            frequency=RecurringFrequency.monthly,
            next_due_date=date(2026, 7, 31),
        )
        db = _MarkPaidDatabase(account)

        asyncio.run(
            mark_paid(
                item,
                db,
                created_by=item.created_by,
                payment_date=date(2026, 7, 31),
            )
        )

        self.assertEqual(account.current_balance, Decimal("150.00"))
        self.assertEqual(db.commit_count, 1)

    def test_mark_paid_can_explicitly_clear_the_recurring_category(self):
        account = Account(
            id=uuid.uuid4(),
            name="Checking",
            type=AccountType.checking,
            current_balance=Decimal("100.00"),
            initial_balance=Decimal("100.00"),
            is_active=True,
        )
        item = _recurring_item()
        item.account_id = account.id
        item.category_id = uuid.uuid4()
        db = _MarkPaidDatabase(account)

        txn = asyncio.run(
            mark_paid(
                item,
                db,
                created_by=item.created_by,
                payment_date=date(2026, 7, 31),
                category_id=None,
                category_id_provided=True,
            )
        )

        self.assertIsNone(txn.category_id)

    def test_deleting_an_older_payment_rewinds_and_keeps_latest_metadata(self):
        item = _recurring_item()
        deleted_payment = _transaction(item.id, date(2026, 1, 22))
        latest_payment = _transaction(item.id, date(2026, 1, 29))
        item.last_paid_transaction_id = latest_payment.id
        db = _DetachDatabase(item, latest_payment)

        asyncio.run(detach_recurring(deleted_payment, db))

        self.assertEqual(item.next_due_date, date(2026, 1, 29))
        self.assertEqual(item.last_paid_date, latest_payment.date)
        self.assertEqual(item.last_paid_amount, latest_payment.amount)
        self.assertEqual(item.last_paid_transaction_id, latest_payment.id)
        self.assertIn("transactions.id !=", str(db.statement))

    def test_deleting_only_payment_clears_last_paid_metadata(self):
        item = _recurring_item()
        deleted_payment = _transaction(item.id, date(2026, 1, 29))
        item.last_paid_transaction_id = deleted_payment.id
        db = _DetachDatabase(item, None)

        asyncio.run(detach_recurring(deleted_payment, db))

        self.assertEqual(item.next_due_date, date(2026, 1, 29))
        self.assertIsNone(item.last_paid_date)
        self.assertIsNone(item.last_paid_amount)
        self.assertIsNone(item.last_paid_transaction_id)


class MoneyValidationTests(unittest.TestCase):
    def setUp(self):
        self.account_id = uuid.uuid4()
        self.category_id = uuid.uuid4()

    def test_transactions_require_positive_amounts(self):
        base = {
            "account_id": self.account_id,
            "amount": Decimal("10.00"),
            "type": TransactionType.expense,
            "date": date(2026, 7, 31),
        }
        self.assertEqual(TransactionCreate(**base).amount, Decimal("10.00"))
        for invalid in (Decimal("0"), Decimal("-0.01")):
            with self.subTest(amount=invalid), self.assertRaises(ValidationError):
                TransactionCreate(**{**base, "amount": invalid})

    def test_update_allows_clearing_nullable_fields_but_not_required_fields(self):
        update = TransactionUpdate(category_id=None, notes=None)
        self.assertEqual(
            update.model_dump(exclude_unset=True),
            {"category_id": None, "notes": None},
        )
        for field_name in ("account_id", "amount", "type", "date"):
            with self.subTest(field=field_name), self.assertRaises(ValidationError):
                TransactionUpdate(**{field_name: None})

    def test_other_updates_reject_null_for_database_required_fields(self):
        cases = (
            (AccountUpdate, ("name", "type", "current_balance", "is_active", "sort_order", "color")),
            (CategoryUpdate, ("name", "type", "color", "sort_order", "once_per_month")),
            (
                MortgageUpdate,
                ("original_principal", "interest_rate", "term_months", "start_date", "extra_payment"),
            ),
        )
        for model, field_names in cases:
            for field_name in field_names:
                with self.subTest(model=model.__name__, field=field_name), self.assertRaises(ValidationError):
                    model(**{field_name: None})

        self.assertEqual(
            AccountUpdate(institution=None).model_dump(exclude_unset=True),
            {"institution": None},
        )
        self.assertEqual(
            CategoryUpdate(icon=None).model_dump(exclude_unset=True),
            {"icon": None},
        )
        self.assertEqual(
            MortgageUpdate(loan_type=None).model_dump(exclude_unset=True),
            {"loan_type": None},
        )

    def test_recurring_mortgage_and_budget_money_constraints(self):
        recurring = {
            "name": "Bill",
            "account_id": self.account_id,
            "amount": Decimal("0"),
            "type": RecurringType.bill,
            "frequency": RecurringFrequency.monthly,
            "next_due_date": date(2026, 8, 1),
        }
        mortgage = {
            "original_principal": Decimal("100000"),
            "interest_rate": Decimal("5"),
            "term_months": 360,
            "start_date": date(2026, 1, 1),
        }
        payment = {
            "source_account_id": self.account_id,
            "source_amount": Decimal("0"),
            "mortgage_amount": Decimal("1"),
            "date": date(2026, 7, 31),
        }

        invalid_models = (
            (RecurringCreate, recurring),
            (MarkPaidRequest, {"amount": Decimal("-1")}),
            (MortgageCreate, {**mortgage, "term_months": 0}),
            (MortgageCreate, {**mortgage, "original_principal": Decimal("0")}),
            (MortgagePaymentCreate, payment),
            (BudgetCreate, {"category_id": self.category_id, "month": date(2026, 7, 1), "amount": Decimal("0")}),
            (MonthlyTargetSet, {"month": date(2026, 7, 1), "amount": Decimal("-1")}),
        )
        for model, values in invalid_models:
            with self.subTest(model=model.__name__), self.assertRaises(ValidationError):
                model(**values)

        with self.assertRaises(ValidationError):
            RecurringUpdate(account_id=None)


class ReferenceValidationTests(unittest.TestCase):
    def test_recurring_mortgage_rejects_its_own_source_account(self):
        account_id = uuid.uuid4()
        db = _SequenceDatabase(SimpleNamespace(type=AccountType.mortgage))

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                _validate_recurring_references(
                    account_id=account_id,
                    category_id=None,
                    expense_account_id=None,
                    recurring_type=RecurringType.bill,
                    source_account_id=account_id,
                    db=db,
                )
            )

        self.assertEqual(raised.exception.status_code, 422)

    def test_transaction_rejects_missing_or_soft_deleted_account(self):
        db = _SequenceDatabase(None)
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                _validate_transaction_references(
                    account_id=uuid.uuid4(),
                    category_id=None,
                    expense_account_id=None,
                    transaction_type=TransactionType.expense,
                    db=db,
                )
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("accounts.is_active = true", str(db.statements[0]))

    def test_transaction_rejects_incompatible_category_type(self):
        db = _SequenceDatabase(
            SimpleNamespace(),
            SimpleNamespace(type=CategoryType.income),
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                _validate_transaction_references(
                    account_id=uuid.uuid4(),
                    category_id=uuid.uuid4(),
                    expense_account_id=None,
                    transaction_type=TransactionType.expense,
                    db=db,
                )
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("expense", raised.exception.detail)

    def test_recurring_income_rejects_expense_category(self):
        db = _SequenceDatabase(
            SimpleNamespace(),
            SimpleNamespace(type=CategoryType.expense),
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                _validate_recurring_references(
                    account_id=uuid.uuid4(),
                    category_id=uuid.uuid4(),
                    expense_account_id=None,
                    recurring_type=RecurringType.income,
                    db=db,
                )
            )
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("income", raised.exception.detail)


class TransactionRouteTests(unittest.TestCase):
    def test_persisted_transfer_legs_have_transfer_as_their_effective_type(self):
        txn = Transaction(
            account_id=uuid.uuid4(),
            transfer_account_id=uuid.uuid4(),
            paired_transaction_id=uuid.uuid4(),
            created_by=uuid.uuid4(),
            amount=Decimal("25.00"),
            type=TransactionType.expense,
            date=date(2026, 7, 31),
        )

        self.assertEqual(_effective_transaction_type(txn), TransactionType.transfer)

    def test_csv_export_is_registered_before_uuid_route(self):
        get_paths = [
            route.path
            for route in transactions_router.routes
            if "GET" in getattr(route, "methods", set())
        ]

        self.assertLess(get_paths.index("/transactions/export"), get_paths.index("/transactions/{transaction_id}"))
        self.assertEqual(get_paths.count("/transactions/{transaction_id}"), 1)

    def test_paired_transaction_integrity_guards_are_present(self):
        source = inspect.getsource(update_transaction)

        self.assertIn("Paired transaction type cannot be changed", source)
        self.assertIn("Mortgage payment amounts cannot be edited independently", source)


if __name__ == "__main__":
    unittest.main()
