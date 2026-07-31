import asyncio
from decimal import Decimal
from types import SimpleNamespace
import unittest

from app.routers.reports import monthly_trend
from app.schemas.report import CashFlowReport, MonthlyIncomeExpense, SpendingByCategory


class _Result:
    def all(self):
        # The database query deliberately returns newest first so LIMIT selects
        # the latest months. The endpoint reverses this for chronological charts.
        return [
            SimpleNamespace(year=2026, month=7, total=Decimal("12.50")),
            SimpleNamespace(year=2026, month=6, total=Decimal("10.00")),
        ]


class _Database:
    statement = None

    async def execute(self, statement):
        self.statement = statement
        return _Result()


class ReportContractTests(unittest.TestCase):
    def test_monthly_trend_limits_newest_and_returns_chronological_order(self):
        db = _Database()

        result = asyncio.run(
            monthly_trend(months=2, category_id=None, db=db, current_user=object())
        )

        self.assertEqual([item.month for item in result], ["2026-06", "2026-07"])
        statement = str(db.statement)
        self.assertIn("ORDER BY", statement)
        self.assertIn("DESC", statement)
        self.assertIn("LIMIT", statement)
        self.assertIn("is_hidden IS NOT true", statement)

    def test_schema_fields_match_the_frontend_contract(self):
        spending = SpendingByCategory(
            category_id="category-id",
            category_name="Groceries",
            color="#112233",
            total=Decimal("25.00"),
            percentage=100,
        )
        month = MonthlyIncomeExpense(
            month="2026-07",
            income=Decimal("100.00"),
            expenses=Decimal("25.00"),
            net=Decimal("75.00"),
        )
        cash_flow = CashFlowReport(
            total_income=month.income,
            total_expenses=month.expenses,
            net=month.net,
            by_month=[month],
        )

        self.assertEqual(
            set(spending.model_dump()),
            {"category_id", "category_name", "color", "total", "percentage"},
        )
        self.assertEqual(
            set(month.model_dump()), {"month", "income", "expenses", "net"}
        )
        self.assertEqual(
            set(cash_flow.model_dump()),
            {"total_income", "total_expenses", "net", "by_month"},
        )
