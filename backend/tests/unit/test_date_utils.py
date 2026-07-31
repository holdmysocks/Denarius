import unittest
from datetime import date

from app.models.recurring_item import RecurringFrequency
from app.utils.date_utils import advance_by_frequency, first_of_month, rewind_by_frequency


class DateUtilsTests(unittest.TestCase):
    def test_advance_by_each_supported_frequency(self) -> None:
        start = date(2024, 1, 15)
        expected = {
            RecurringFrequency.weekly: date(2024, 1, 22),
            RecurringFrequency.biweekly: date(2024, 1, 29),
            RecurringFrequency.monthly: date(2024, 2, 15),
            RecurringFrequency.quarterly: date(2024, 4, 15),
            RecurringFrequency.annually: date(2025, 1, 15),
        }

        for frequency, due_date in expected.items():
            with self.subTest(frequency=frequency):
                self.assertEqual(advance_by_frequency(start, frequency), due_date)

    def test_monthly_arithmetic_handles_end_of_month(self) -> None:
        self.assertEqual(
            advance_by_frequency(date(2024, 1, 31), RecurringFrequency.monthly),
            date(2024, 2, 29),
        )
        self.assertEqual(
            rewind_by_frequency(date(2023, 3, 31), RecurringFrequency.monthly),
            date(2023, 2, 28),
        )

    def test_first_of_month_preserves_year_and_month(self) -> None:
        self.assertEqual(first_of_month(date(2025, 12, 31)), date(2025, 12, 1))


if __name__ == "__main__":
    unittest.main()
