import asyncio
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
import unittest
import uuid

from fastapi import HTTPException

from app.models.account import Account, AccountType
from app.models.mortgage_detail import MortgageDetail
from app.models.transaction import Transaction
from app.routers.accounts import (
    _validate_account_relationship,
    create_account_with_mortgage,
    router as accounts_router,
)
from app.routers.mortgage import _require_mortgage_account, record_mortgage_payment
from app.schemas.account import AccountWithMortgageCreate
from app.schemas.mortgage import MortgagePaymentCreate


class _Result:
    def __init__(self, scalar=None, scalars=None):
        self._scalar = scalar
        self._scalars = scalars or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return SimpleNamespace(all=lambda: self._scalars)


class _RelationshipDatabase:
    def __init__(self, linked_account=None):
        self.linked_account = linked_account

    async def execute(self, statement):
        return _Result(scalar=self.linked_account)


class _PaymentDatabase:
    def __init__(self, mortgage_account, source_account):
        self.account_results = [mortgage_account, source_account]
        self.added = []
        self.commit_count = 0

    async def execute(self, statement):
        sql = str(statement)
        if "FROM accounts" in sql:
            return _Result(scalar=self.account_results.pop(0))
        if "FROM categories" in sql:
            return _Result()
        if "FROM recurring_items" in sql:
            return _Result(scalars=[])
        raise AssertionError(f"Unexpected statement: {sql}")

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        for value in self.added:
            if isinstance(value, Transaction) and value.id is None:
                value.id = uuid.uuid4()

    async def commit(self):
        self.commit_count += 1


class _CreateDatabase:
    def __init__(self):
        self.added = []
        self.commit_count = 0

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        for value in self.added:
            if isinstance(value, Account) and value.id is None:
                value.id = uuid.uuid4()

    async def commit(self):
        self.commit_count += 1

    async def refresh(self, value):
        return None


class AccountMortgageIntegrityTests(unittest.TestCase):
    def test_atomic_account_routes_are_registered(self):
        routes = {(method, route.path) for route in accounts_router.routes for method in route.methods}
        self.assertIn(("POST", "/accounts/with-mortgage"), routes)
        self.assertIn(("PUT", "/accounts/{account_id}/with-mortgage"), routes)

    def test_only_property_accounts_can_link_active_mortgages(self):
        mortgage = Account(
            id=uuid.uuid4(),
            name="Mortgage",
            type=AccountType.mortgage,
            current_balance=Decimal("-100000"),
            initial_balance=Decimal("-100000"),
            is_active=True,
        )
        db = _RelationshipDatabase(mortgage)
        asyncio.run(
            _validate_account_relationship(
                AccountType.property, mortgage.id, db
            )
        )

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                _validate_account_relationship(
                    AccountType.checking, mortgage.id, db
                )
            )
        self.assertEqual(raised.exception.status_code, 422)

    def test_mortgage_details_require_a_loan_account(self):
        _require_mortgage_account(SimpleNamespace(type=AccountType.mortgage))
        _require_mortgage_account(SimpleNamespace(type=AccountType.loan))
        with self.assertRaises(HTTPException) as raised:
            _require_mortgage_account(SimpleNamespace(type=AccountType.property))
        self.assertEqual(raised.exception.status_code, 422)

    def test_property_and_new_mortgage_are_created_in_one_commit(self):
        db = _CreateDatabase()
        request = AccountWithMortgageCreate.model_validate(
            {
                "account": {
                    "name": "Home",
                    "type": "property",
                    "current_balance": "300000",
                },
                "new_linked_mortgage": {
                    "name": "Home Mortgage",
                    "mortgage": {
                        "original_principal": "250000",
                        "interest_rate": "5.25",
                        "term_months": 360,
                        "start_date": "2026-01-01",
                    },
                },
            }
        )

        property_account = asyncio.run(
            create_account_with_mortgage(
                data=request,
                db=db,
                current_user=SimpleNamespace(id=uuid.uuid4()),
            )
        )

        accounts = [value for value in db.added if isinstance(value, Account)]
        details = [value for value in db.added if isinstance(value, MortgageDetail)]
        mortgage_account = next(
            value for value in accounts if value.type == AccountType.mortgage
        )
        self.assertEqual(db.commit_count, 1)
        self.assertEqual(property_account.linked_mortgage_id, mortgage_account.id)
        self.assertEqual(details[0].account_id, mortgage_account.id)

    def test_mortgage_payment_uses_one_commit(self):
        mortgage = Account(
            id=uuid.uuid4(),
            name="Mortgage",
            type=AccountType.mortgage,
            current_balance=Decimal("-100000"),
            initial_balance=Decimal("-100000"),
            is_active=True,
        )
        source = Account(
            id=uuid.uuid4(),
            name="Checking",
            type=AccountType.checking,
            current_balance=Decimal("5000"),
            initial_balance=Decimal("5000"),
            is_active=True,
        )
        db = _PaymentDatabase(mortgage, source)
        request = MortgagePaymentCreate(
            source_account_id=source.id,
            source_amount=Decimal("1500"),
            mortgage_amount=Decimal("1000"),
            date=date(2026, 7, 31),
        )

        result = asyncio.run(
            record_mortgage_payment(
                account_id=mortgage.id,
                data=request,
                db=db,
                current_user=SimpleNamespace(id=uuid.uuid4()),
            )
        )

        self.assertEqual(db.commit_count, 1)
        self.assertEqual(source.current_balance, Decimal("3500"))
        self.assertEqual(mortgage.current_balance, Decimal("-99000"))
        self.assertIsNotNone(result.source_transaction_id)
        self.assertIsNotNone(result.mortgage_transaction_id)

    def test_mortgage_payment_rejects_the_mortgage_as_its_own_source(self):
        mortgage = Account(
            id=uuid.uuid4(),
            name="Mortgage",
            type=AccountType.mortgage,
            current_balance=Decimal("-100000"),
            initial_balance=Decimal("-100000"),
            is_active=True,
        )
        db = _PaymentDatabase(mortgage, mortgage)
        request = MortgagePaymentCreate(
            source_account_id=mortgage.id,
            source_amount=Decimal("1500"),
            mortgage_amount=Decimal("1000"),
            date=date(2026, 7, 31),
        )

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                record_mortgage_payment(
                    account_id=mortgage.id,
                    data=request,
                    db=db,
                    current_user=SimpleNamespace(id=uuid.uuid4()),
                )
            )

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(db.commit_count, 0)


if __name__ == "__main__":
    unittest.main()
