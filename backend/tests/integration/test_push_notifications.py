"""PostgreSQL tests for push alerts: what is sent, to whom, and only once."""

import os
import unittest
import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from sqlalchemy import delete, select

from app.database import AsyncSessionLocal, engine
from app.models.account import Account, AccountType
from app.models.budget import Budget
from app.models.category import Category, CategoryType
from app.models.push_subscription import NotificationLog, PushSubscription
from app.models.recurring_item import RecurringFrequency, RecurringItem, RecurringType
from app.models.transaction import Transaction, TransactionType
from app.models.user import User, UserRole
from app.services import alert_service, push_service
from app.utils.app_date import get_app_date
from app.utils.date_utils import first_of_month


@unittest.skipUnless(os.getenv("RUN_DATABASE_TESTS") == "1", "PostgreSQL integration tests are enabled in CI")
class PushAlertTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Pooled connections from a previous test class belong to its loop.
        await engine.dispose(close=False)
        self.db = AsyncSessionLocal()
        # Alerts are household-wide, so earlier tests' bills would show up too;
        # start each test from a clean slate of alert sources.
        await self.db.execute(delete(NotificationLog))
        await self.db.execute(delete(PushSubscription))
        await self.db.execute(RecurringItem.__table__.update().values(is_active=False))
        await self.db.execute(delete(Budget))
        await self.db.commit()

        self.suffix = uuid.uuid4().hex
        self.today = await get_app_date(self.db)
        self.user = User(
            username=f"push-{self.suffix}", email=f"push-{self.suffix}@example.com",
            password_hash="x", role=UserRole.member, is_active=True,
        )
        self.account = Account(
            name=f"Checking {self.suffix}", type=AccountType.checking,
            current_balance=Decimal("0"), initial_balance=Decimal("0"), is_active=True,
        )
        self.db.add_all([self.user, self.account])
        await self.db.flush()
        self.sub = PushSubscription(
            user_id=self.user.id, endpoint=f"https://fcm.googleapis.com/fcm/send/{self.suffix}",
            p256dh="key", auth="auth",
        )
        self.db.add(self.sub)
        await self.db.commit()

    async def asyncTearDown(self):
        await self.db.close()
        await engine.dispose()

    def _bill(self, days: int, **kwargs) -> RecurringItem:
        defaults = dict(
            name=f"Power {self.suffix}", account_id=self.account.id, created_by=self.user.id,
            amount=Decimal("80.00"), type=RecurringType.bill, frequency=RecurringFrequency.monthly,
            next_due_date=self.today + timedelta(days=days),
        )
        defaults.update(kwargs)
        return RecurringItem(**defaults)

    async def _run(self, results=None):
        """Run the alert job with push delivery mocked. Returns the messages sent."""
        sent = []

        def fake_send(sub, payload, vapid, subject):
            sent.append(payload)
            return (results or {}).get(sub.endpoint)

        with patch.object(push_service, "_send_one", side_effect=fake_send):
            await alert_service.send_pending_alerts(self.db, self.today)
        return sent

    async def test_bill_due_tomorrow_is_sent_once(self):
        self.db.add(self._bill(1))
        await self.db.commit()

        first = await self._run()
        second = await self._run()

        self.assertEqual(len(first), 1)
        self.assertIn("due tomorrow", first[0])
        self.assertEqual(second, [])

    async def test_income_and_far_off_items_are_not_alerts(self):
        self.db.add_all([
            self._bill(1, type=RecurringType.income, name="Paycheck"),
            self._bill(5),
        ])
        await self.db.commit()
        self.assertEqual(await self._run(), [])

    async def test_turning_off_bills_stops_bill_alerts(self):
        self.user.push_bills = False
        self.db.add(self._bill(0))
        await self.db.commit()
        self.assertEqual(await self._run(), [])

    async def test_over_budget_category_alerts_once(self):
        category = Category(name=f"Dining {self.suffix}", type=CategoryType.expense)
        self.db.add(category)
        await self.db.flush()
        self.db.add_all([
            Budget(category_id=category.id, month=first_of_month(self.today), amount=Decimal("50.00")),
            Transaction(
                account_id=self.account.id, category_id=category.id, created_by=self.user.id,
                amount=Decimal("75.00"), type=TransactionType.expense, date=self.today,
            ),
        ])
        await self.db.commit()

        first = await self._run()
        second = await self._run()

        self.assertEqual(len(first), 1)
        self.assertIn("over budget", first[0])
        self.assertEqual(second, [])

    async def test_failed_delivery_is_retried_and_gone_devices_are_removed(self):
        self.db.add(self._bill(1))
        await self.db.commit()

        # Push service down: nothing is logged, so the next run tries again.
        self.assertEqual(len(await self._run({self.sub.endpoint: 503})), 1)
        self.assertEqual(len(await self._run({self.sub.endpoint: 503})), 1)

        # The device was uninstalled: its subscription is deleted.
        await self._run({self.sub.endpoint: 410})
        remaining = await self.db.scalar(select(PushSubscription.id).where(PushSubscription.id == self.sub.id))
        self.assertIsNone(remaining)

    async def test_public_key_is_stable(self):
        first = await push_service.get_public_key(self.db)
        second = await push_service.get_public_key(self.db)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 87)  # 65-byte uncompressed P-256 point, base64url
