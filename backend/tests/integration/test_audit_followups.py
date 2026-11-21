"""PostgreSQL regression tests for the November 2026 audit follow-up fixes."""

import asyncio
import io
import json
import os
import unittest
import uuid
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from starlette.datastructures import UploadFile

from app.database import AsyncSessionLocal, engine
from app.models.account import Account, AccountType
from app.models.category import Category, CategoryType
from app.models.extra_expense import ExtraExpense, ExtraExpenseFrequency
from app.models.recurring_item import RecurringFrequency, RecurringItem, RecurringType
from app.models.shortcut_settings import ShortcutSettings
from app.models.transaction import Transaction
from app.models.user import User, UserRole
from app.routers.export import export_data, import_data
from app.routers.forecast import get_forecast
from app.routers import shortcuts as shortcuts_router
from app.dependencies import get_current_user
from app.models.app_setting import AppSetting
from app.utils.security import create_access_token
from datetime import datetime, timezone
from fastapi.security import HTTPAuthorizationCredentials
from app.routers.transactions import create_transaction
from app.routers.users import delete_user_permanently
from app.schemas.transaction import TransactionCreate


def _make_user(suffix: str) -> User:
    return User(
        username=f"ci-{suffix}",
        email=f"ci-{suffix}@example.test",
        password_hash="not-used-by-this-test",
        role=UserRole.member,
        is_active=True,
    )


@unittest.skipUnless(
    os.getenv("RUN_DATABASE_TESTS") == "1",
    "PostgreSQL integration tests are enabled in CI",
)
class AuditFollowupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = AsyncSessionLocal()
        self.suffix = uuid.uuid4().hex
        self.user = _make_user(self.suffix)
        self.checking = Account(
            name=f"Checking {self.suffix}",
            type=AccountType.checking,
            current_balance=Decimal("1000.00"),
            initial_balance=Decimal("1000.00"),
            is_active=True,
        )
        self.db.add_all([self.user, self.checking])
        await self.db.commit()

    async def asyncTearDown(self):
        await self.db.close()
        # Each test runs on its own event loop; pooled asyncpg connections are
        # bound to the loop that opened them, so drop them between tests.
        await engine.dispose()

    async def test_auto_match_records_the_paying_transaction(self):
        keyword = f"STREAMCO{self.suffix[:8]}"
        item = RecurringItem(
            name=f"Streaming {self.suffix}",
            account_id=self.checking.id,
            created_by=self.user.id,
            amount=Decimal("15.49"),
            type=RecurringType.subscription,
            frequency=RecurringFrequency.monthly,
            next_due_date=date.today(),
            auto_match=True,
            keyword_match=keyword,
        )
        self.db.add(item)
        await self.db.commit()

        txn = await create_transaction(
            TransactionCreate(
                account_id=self.checking.id,
                amount=Decimal("15.49"),
                type="expense",
                description=f"{keyword} monthly charge",
                date=date.today(),
            ),
            self.db,
            self.user,
        )

        await self.db.refresh(item)
        self.assertEqual(txn.recurring_item_id, item.id)
        self.assertIsNotNone(item.last_paid_transaction_id)
        self.assertEqual(item.last_paid_transaction_id, txn.id)

    async def test_once_per_month_conflict_after_override_is_409_not_500(self):
        category = Category(
            name=f"Rent {self.suffix}",
            type=CategoryType.expense,
            once_per_month=True,
        )
        self.db.add(category)
        await self.db.commit()

        def payment(override=None):
            return TransactionCreate(
                account_id=self.checking.id,
                category_id=category.id,
                amount=Decimal("100.00"),
                type="expense",
                description="Rent",
                date=date.today(),
                once_per_month_override=override,
            )

        await create_transaction(payment(), self.db, self.user)
        await create_transaction(payment("extra_payment"), self.db, self.user)

        with self.assertRaises(HTTPException) as ctx:
            await create_transaction(payment(), self.db, self.user)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_permanent_delete_reassigns_extra_expenses(self):
        doomed = _make_user(uuid.uuid4().hex)
        self.db.add(doomed)
        await self.db.commit()
        expense = ExtraExpense(
            name=f"Groceries {self.suffix}",
            amount=Decimal("400.00"),
            frequency=ExtraExpenseFrequency.monthly,
            created_by=doomed.id,
        )
        self.db.add(expense)
        await self.db.commit()

        await delete_user_permanently(doomed.id, self.db, self.user)

        await self.db.refresh(expense)
        self.assertEqual(expense.created_by, self.user.id)
        self.assertIsNone(await self.db.get(User, doomed.id))

    async def test_export_import_round_trips_extra_expenses_and_shortcut_settings(self):
        expense = ExtraExpense(
            name=f"Gas {self.suffix}",
            amount=Decimal("120.50"),
            frequency=ExtraExpenseFrequency.yearly,
            notes="fuel",
            created_by=self.user.id,
        )
        settings = ShortcutSettings(
            user_id=self.user.id,
            expense_ask_description=False,
            expense_ask_category=True,
            expense_ask_account=False,
            expense_default_account_id=self.checking.id,
            income_ask_description=True,
            income_ask_category=False,
            income_ask_account=True,
            auto_category=False,
            confirmation="speak",
        )
        self.db.add_all([expense, settings])
        await self.db.commit()

        response = await export_data(
            include_settings=True,
            include_forecast=True,
            db=self.db,
            current_user=self.user,
        )
        body = b"".join(
            [chunk if isinstance(chunk, bytes) else chunk.encode() async for chunk in response.body_iterator]
        )
        payload = json.loads(body)

        exported = [e for e in payload["extra_expenses"] if e["id"] == str(expense.id)]
        self.assertEqual(len(exported), 1)
        self.assertEqual(exported[0]["frequency"], "yearly")
        exported_settings = payload["user_preferences"]["shortcut_settings"]
        self.assertEqual(exported_settings["confirmation"], "speak")
        self.assertEqual(exported_settings["expense_default_account_id"], str(self.checking.id))

        # Restore into a "fresh" state: a new expense ID and changed settings.
        restored_id = uuid.uuid4()
        exported[0]["id"] = str(restored_id)
        payload["extra_expenses"] = exported
        payload.pop("settings", None)  # leave global app settings untouched
        settings.confirmation = "none"
        settings.expense_default_account_id = None
        settings.auto_category = True
        await self.db.commit()

        raw = json.dumps(payload).encode()
        result = await import_data(
            UploadFile(file=io.BytesIO(raw), size=len(raw), filename="restore.json"),
            self.db,
            self.user,
        )
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["imported"]["extra_expenses"], 1)

        restored = await self.db.get(ExtraExpense, restored_id)
        self.assertIsNotNone(restored)
        self.assertEqual(restored.amount, Decimal("120.50"))
        self.assertEqual(restored.created_by, self.user.id)

        await self.db.refresh(settings)
        self.assertEqual(settings.confirmation, "speak")
        self.assertEqual(settings.expense_default_account_id, self.checking.id)
        self.assertFalse(settings.auto_category)

    async def test_refund_does_not_pay_the_matching_subscription(self):
        keyword = f"VIDCO{self.suffix[:8]}"
        item = RecurringItem(
            name=f"Video {self.suffix}",
            account_id=self.checking.id,
            created_by=self.user.id,
            amount=Decimal("15.49"),
            type=RecurringType.subscription,
            frequency=RecurringFrequency.monthly,
            next_due_date=date.today(),
            auto_match=True,
            keyword_match=keyword,
        )
        self.db.add(item)
        await self.db.commit()
        due_before = item.next_due_date

        refund = await create_transaction(
            TransactionCreate(
                account_id=self.checking.id,
                amount=Decimal("15.49"),
                type="income",
                description=f"{keyword} refund",
                date=date.today(),
            ),
            self.db,
            self.user,
        )

        await self.db.refresh(item)
        self.assertIsNone(refund.recurring_item_id)
        self.assertEqual(item.next_due_date, due_before)

    async def test_concurrent_adds_to_one_account_keep_every_change(self):
        async def add(amount: str):
            async with AsyncSessionLocal() as session:
                user = await session.get(User, self.user.id)
                await create_transaction(
                    TransactionCreate(
                        account_id=self.checking.id,
                        amount=Decimal(amount),
                        type="expense",
                        description="concurrent",
                        date=date.today(),
                    ),
                    session,
                    user,
                )

        await asyncio.gather(*(add("10.00") for _ in range(8)))

        await self.db.refresh(self.checking)
        self.assertEqual(self.checking.current_balance, Decimal("920.00"))

    async def test_forecast_ignores_items_on_deleted_accounts(self):
        doomed = Account(
            name=f"Closed {self.suffix}",
            type=AccountType.checking,
            current_balance=Decimal("0"),
            initial_balance=Decimal("0"),
            is_active=True,
        )
        self.db.add(doomed)
        await self.db.commit()
        name = f"Rent on closed account {self.suffix}"
        self.db.add(
            RecurringItem(
                name=name,
                account_id=doomed.id,
                created_by=self.user.id,
                amount=Decimal("900.00"),
                type=RecurringType.bill,
                frequency=RecurringFrequency.monthly,
                next_due_date=date.today(),
            )
        )
        from datetime import datetime, timezone

        doomed.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()

        forecast = await get_forecast(
            include_budgets=False, budget_month=None, db=self.db, current_user=self.user
        )
        names = {line.name for group in forecast.expense_groups for line in group.items}
        self.assertNotIn(name, names)

    async def test_deleted_users_tokens_are_rejected(self):
        token = create_access_token({"sub": str(self.user.id)})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        self.assertEqual((await get_current_user(creds, self.db)).id, self.user.id)

        self.user.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            await get_current_user(creds, self.db)
        self.assertEqual(ctx.exception.status_code, 401)

    async def test_api_key_cap(self):
        for i in range(shortcuts_router.MAX_ACTIVE_API_KEYS):
            await shortcuts_router.create_key(
                shortcuts_router.ApiKeyCreate(name=f"key {i}"), self.db, self.user
            )
        with self.assertRaises(HTTPException) as ctx:
            await shortcuts_router.create_key(
                shortcuts_router.ApiKeyCreate(name="one too many"), self.db, self.user
            )
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_concurrent_first_settings_saves_do_not_conflict(self):
        body = shortcuts_router.ShortcutSettingsBody(
            expense=shortcuts_router.ShortcutOptions(
                ask_description=True, ask_category=False, ask_account=False
            ),
            income=shortcuts_router.ShortcutOptions(
                ask_description=True, ask_category=False, ask_account=False
            ),
            auto_category=False,
            confirmation="speak",
        )

        async def save():
            async with AsyncSessionLocal() as session:
                user = await session.get(User, self.user.id)
                return await shortcuts_router.update_shortcut_settings(body, session, user)

        results = await asyncio.gather(save(), save(), save())
        self.assertTrue(all(r.confirmation == "speak" for r in results))
        stored = await self.db.get(ShortcutSettings, self.user.id)
        self.assertFalse(stored.auto_category)

    async def test_shortcut_link_can_be_unshared_and_reset(self):
        key = shortcuts_router.SHORTCUT_LINK_KEYS["expense"]
        original = await self.db.get(AppSetting, key)
        original_value = original.value if original else None
        try:
            await shortcuts_router.set_shortcut_link(
                shortcuts_router.ShortcutLinkUpdate(kind="expense", shortcut_url=None),
                self.db,
                self.user,
            )
            settings = await shortcuts_router.get_shortcut_settings(self.db, self.user)
            self.assertIsNone(settings.expense_shortcut_url)
            self.assertFalse(settings.expense_shortcut_is_default)

            await shortcuts_router.reset_shortcut_link("expense", self.db, self.user)
            settings = await shortcuts_router.get_shortcut_settings(self.db, self.user)
            self.assertEqual(
                settings.expense_shortcut_url, shortcuts_router.DEFAULT_SHORTCUT_LINKS["expense"]
            )
            self.assertTrue(settings.expense_shortcut_is_default)
        finally:
            row = await self.db.get(AppSetting, key)
            if original_value is None:
                if row is not None:
                    await self.db.delete(row)
            elif row is None:
                self.db.add(AppSetting(key=key, value=original_value))
            else:
                row.value = original_value
            await self.db.commit()
