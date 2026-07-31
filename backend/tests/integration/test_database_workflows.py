import os
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.account import Account, AccountType
from app.models.recurring_item import RecurringFrequency, RecurringItem, RecurringType
from app.models.transaction import Transaction, TransactionType
from app.models.user import User, UserRole
from app.routers.mortgage import record_mortgage_payment
from app.routers.transactions import (
    create_transaction,
    delete_transaction,
    list_transactions,
    update_transaction,
)
from app.schemas.mortgage import MortgagePaymentCreate
from app.schemas.transaction import TransactionCreate, TransactionUpdate
from app.services.recurring_service import auto_post_due_items, mark_paid


@unittest.skipUnless(
    os.getenv("RUN_DATABASE_TESTS") == "1",
    "PostgreSQL integration tests are enabled in CI",
)
class DatabaseMoneyFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = AsyncSessionLocal()
        suffix = uuid.uuid4().hex
        self.user = User(
            username=f"ci-{suffix}",
            email=f"ci-{suffix}@example.test",
            password_hash="not-used-by-this-test",
            role=UserRole.member,
            is_active=True,
        )
        self.checking = Account(
            name=f"Checking {suffix}",
            type=AccountType.checking,
            current_balance=Decimal("1000.00"),
            initial_balance=Decimal("1000.00"),
            is_active=True,
        )
        self.savings = Account(
            name=f"Savings {suffix}",
            type=AccountType.savings,
            current_balance=Decimal("100.00"),
            initial_balance=Decimal("100.00"),
            is_active=True,
        )
        self.mortgage = Account(
            name=f"Mortgage {suffix}",
            type=AccountType.mortgage,
            current_balance=Decimal("-200000.00"),
            initial_balance=Decimal("-200000.00"),
            is_active=True,
        )
        self.db.add_all([self.user, self.checking, self.savings, self.mortgage])
        await self.db.commit()

    async def asyncTearDown(self):
        await self.db.close()

    async def _refresh_accounts(self):
        await self.db.refresh(self.checking)
        await self.db.refresh(self.savings)
        await self.db.refresh(self.mortgage)

    async def test_transactions_transfers_mortgage_and_recurring_balances(self):
        today = date.today()

        await create_transaction(
            TransactionCreate(
                account_id=self.checking.id,
                amount=Decimal("200.00"),
                type="income",
                description="Integration income",
                date=today,
            ),
            self.db,
            self.user,
        )
        await create_transaction(
            TransactionCreate(
                account_id=self.checking.id,
                amount=Decimal("50.00"),
                type="expense",
                description="Integration bill",
                date=today,
            ),
            self.db,
            self.user,
        )
        transfer = await create_transaction(
            TransactionCreate(
                account_id=self.checking.id,
                transfer_account_id=self.savings.id,
                amount=Decimal("125.00"),
                type="transfer",
                description="Integration transfer",
                date=today,
            ),
            self.db,
            self.user,
        )
        await self._refresh_accounts()
        self.assertEqual(self.checking.current_balance, Decimal("1025.00"))
        self.assertEqual(self.savings.current_balance, Decimal("225.00"))
        self.assertIsNotNone(transfer.paired_transaction_id)

        transfer_page = await list_transactions(
            page=1,
            limit=50,
            account_id=self.checking.id,
            category_id=None,
            type=TransactionType.transfer,
            search=None,
            start_date=None,
            end_date=None,
            expense_account_id=None,
            db=self.db,
            current_user=self.user,
        )
        expense_page = await list_transactions(
            page=1,
            limit=50,
            account_id=self.checking.id,
            category_id=None,
            type=TransactionType.expense,
            search=None,
            start_date=None,
            end_date=None,
            expense_account_id=None,
            db=self.db,
            current_user=self.user,
        )
        self.assertEqual(transfer_page.total, 1)
        self.assertEqual(transfer_page.items[0].id, transfer.id)
        self.assertEqual(expense_page.total, 1)
        self.assertEqual(expense_page.items[0].description, "Integration bill")

        await update_transaction(
            transfer.id,
            TransactionUpdate(amount=Decimal("150.00")),
            self.db,
            self.user,
        )
        await self._refresh_accounts()
        self.assertEqual(self.checking.current_balance, Decimal("1000.00"))
        self.assertEqual(self.savings.current_balance, Decimal("250.00"))

        with self.assertRaises(HTTPException) as raised:
            await update_transaction(
                transfer.id,
                TransactionUpdate(type="income"),
                self.db,
                self.user,
            )
        self.assertEqual(raised.exception.status_code, 400)
        await self._refresh_accounts()
        self.assertEqual(self.checking.current_balance, Decimal("1000.00"))
        self.assertEqual(self.savings.current_balance, Decimal("250.00"))

        self.savings.is_active = False
        self.savings.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()
        await delete_transaction(transfer.id, self.db, self.user)
        await self._refresh_accounts()
        self.assertEqual(self.checking.current_balance, Decimal("1150.00"))
        self.assertEqual(self.savings.current_balance, Decimal("100.00"))

        payment = await record_mortgage_payment(
            self.mortgage.id,
            MortgagePaymentCreate(
                source_account_id=self.checking.id,
                source_amount=Decimal("1200.00"),
                mortgage_amount=Decimal("1000.00"),
                date=today,
            ),
            self.db,
            self.user,
        )
        await self._refresh_accounts()
        self.assertEqual(self.checking.current_balance, Decimal("-50.00"))
        self.assertEqual(self.mortgage.current_balance, Decimal("-199000.00"))

        with self.assertRaises(HTTPException) as raised:
            await update_transaction(
                payment.source_transaction_id,
                TransactionUpdate(amount=Decimal("1300.00")),
                self.db,
                self.user,
            )
        self.assertEqual(raised.exception.status_code, 400)
        await self._refresh_accounts()
        self.assertEqual(self.checking.current_balance, Decimal("-50.00"))
        self.assertEqual(self.mortgage.current_balance, Decimal("-199000.00"))

        await delete_transaction(payment.source_transaction_id, self.db, self.user)
        await self._refresh_accounts()
        self.assertEqual(self.checking.current_balance, Decimal("1150.00"))
        self.assertEqual(self.mortgage.current_balance, Decimal("-200000.00"))

        recurring_items = [
            RecurringItem(
                name=f"Subscription {uuid.uuid4().hex}",
                account_id=self.checking.id,
                created_by=self.user.id,
                amount=Decimal("10.00"),
                type=RecurringType.subscription,
                frequency=RecurringFrequency.monthly,
                next_due_date=today,
            ),
            RecurringItem(
                name=f"Bill {uuid.uuid4().hex}",
                account_id=self.checking.id,
                created_by=self.user.id,
                amount=Decimal("40.00"),
                type=RecurringType.bill,
                frequency=RecurringFrequency.monthly,
                next_due_date=today,
            ),
            RecurringItem(
                name=f"Income {uuid.uuid4().hex}",
                account_id=self.checking.id,
                created_by=self.user.id,
                amount=Decimal("250.00"),
                type=RecurringType.income,
                frequency=RecurringFrequency.monthly,
                next_due_date=today,
            ),
        ]
        self.db.add_all(recurring_items)
        await self.db.commit()
        recurring_transactions = []
        for item in recurring_items:
            recurring_transactions.append(
                await mark_paid(item, self.db, self.user.id, payment_date=today)
            )

        await self.db.refresh(self.checking)
        self.assertEqual(self.checking.current_balance, Decimal("1350.00"))
        self.assertTrue(all(item.last_paid_transaction_id for item in recurring_items))

        subscription_txn = recurring_transactions[0]
        revised_date = today - timedelta(days=1)
        await update_transaction(
            subscription_txn.id,
            TransactionUpdate(date=revised_date),
            self.db,
            self.user,
        )
        await self.db.refresh(recurring_items[0])
        self.assertEqual(recurring_items[0].last_paid_date, revised_date)
        for forbidden_update in (
            TransactionUpdate(account_id=self.mortgage.id),
            TransactionUpdate(type="income"),
        ):
            with self.assertRaises(HTTPException) as raised:
                await update_transaction(
                    subscription_txn.id,
                    forbidden_update,
                    self.db,
                    self.user,
                )
            self.assertEqual(raised.exception.status_code, 400)

        auto_item = RecurringItem(
            name=f"Auto post {uuid.uuid4().hex}",
            account_id=self.checking.id,
            created_by=self.user.id,
            amount=Decimal("25.00"),
            type=RecurringType.bill,
            frequency=RecurringFrequency.monthly,
            next_due_date=today,
            auto_post=True,
        )
        self.db.add(auto_item)
        await self.db.commit()
        self.assertEqual(await auto_post_due_items(self.db), 1)
        self.assertEqual(await auto_post_due_items(self.db), 0)
        await self.db.refresh(self.checking)
        self.assertEqual(self.checking.current_balance, Decimal("1325.00"))

        paired_rows = (
            await self.db.execute(
                select(Transaction).where(
                    Transaction.id.in_(
                        [payment.source_transaction_id, payment.mortgage_transaction_id]
                    )
                )
            )
        ).scalars().all()
        self.assertTrue(all(row.deleted_at is not None for row in paired_rows))
