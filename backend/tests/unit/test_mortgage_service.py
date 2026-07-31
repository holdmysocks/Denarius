import unittest
from datetime import date
from decimal import Decimal

from app.services.mortgage_service import (
    _monthly_payment,
    build_amortization_schedule,
    calculate_extra_payment_savings,
)


class MortgageServiceTests(unittest.TestCase):
    def test_zero_interest_payment_is_principal_divided_by_term(self) -> None:
        self.assertEqual(
            _monthly_payment(Decimal("1200.00"), Decimal("0"), 12),
            Decimal("100.00"),
        )

    def test_zero_interest_schedule_pays_balance_in_full(self) -> None:
        schedule = build_amortization_schedule(
            original_principal=Decimal("1200.00"),
            annual_rate=Decimal("0"),
            term_months=12,
            start_date=date(2025, 1, 1),
        )

        self.assertEqual(len(schedule), 12)
        self.assertEqual(schedule[0].payment_date, date(2025, 2, 1))
        self.assertEqual(schedule[-1].payment_date, date(2026, 1, 1))
        self.assertEqual(schedule[-1].balance, Decimal("0.00"))
        self.assertEqual(schedule[-1].cumulative_interest, Decimal("0.00"))

    def test_extra_payment_reduces_term_and_interest(self) -> None:
        result = calculate_extra_payment_savings(
            original_principal=Decimal("250000.00"),
            annual_rate=Decimal("6.5"),
            term_months=360,
            start_date=date(2025, 1, 1),
            extra_monthly=Decimal("200.00"),
        )

        self.assertGreater(result.months_saved, 0)
        self.assertGreater(result.interest_saved, Decimal("0.00"))
        self.assertLess(result.new_payoff_date, date(2055, 1, 1))


if __name__ == "__main__":
    unittest.main()
