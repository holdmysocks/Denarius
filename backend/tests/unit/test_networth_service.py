import asyncio
from datetime import date
from decimal import Decimal
import unittest
from unittest.mock import AsyncMock, patch

from app.models.account import AccountType
from app.schemas.net_worth import NetWorthCurrent
from app.services.networth_service import classify_account_balance, create_snapshot


class _NoSnapshotResult:
    def scalar_one_or_none(self):
        return None


class _SnapshotDatabase:
    added = None

    async def execute(self, statement):
        return _NoSnapshotResult()

    def add(self, snapshot):
        self.added = snapshot

    async def commit(self):
        return None

    async def refresh(self, snapshot):
        return None


class ClassifyAccountBalanceTests(unittest.TestCase):
    def test_known_and_other_account_types(self):
        cases = [
            (AccountType.checking, Decimal("125.50"), (True, Decimal("125.50"))),
            (AccountType.credit_card, Decimal("-42.10"), (False, Decimal("42.10"))),
            (AccountType.other, Decimal("75.00"), (True, Decimal("75.00"))),
            (AccountType.other, Decimal("-75.00"), (False, Decimal("75.00"))),
            (AccountType.other, Decimal("0.00"), (True, Decimal("0.00"))),
        ]

        for account_type, balance, expected in cases:
            with self.subTest(account_type=account_type, balance=balance):
                self.assertEqual(
                    classify_account_balance(account_type, balance), expected
                )

    def test_snapshot_default_uses_first_day_in_the_app_timezone(self):
        db = _SnapshotDatabase()
        current = NetWorthCurrent(
            total_assets=Decimal("100.00"),
            total_liabilities=Decimal("25.00"),
            net_worth=Decimal("75.00"),
            accounts=[],
        )

        with (
            patch(
                "app.services.networth_service.get_app_date",
                new=AsyncMock(return_value=date(2026, 7, 31)),
            ) as app_date,
            patch(
                "app.services.networth_service.get_current_net_worth",
                new=AsyncMock(return_value=current),
            ),
        ):
            snapshot = asyncio.run(create_snapshot(db))

        app_date.assert_awaited_once_with(db)
        self.assertEqual(snapshot.snapshot_date, date(2026, 7, 1))
