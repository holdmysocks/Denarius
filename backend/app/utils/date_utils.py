from datetime import date
from dateutil.relativedelta import relativedelta

from app.models.recurring_item import RecurringFrequency


def advance_by_frequency(current_date: date, frequency: RecurringFrequency) -> date:
    match frequency:
        case RecurringFrequency.weekly:
            return current_date + relativedelta(weeks=1)
        case RecurringFrequency.biweekly:
            return current_date + relativedelta(weeks=2)
        case RecurringFrequency.monthly:
            return current_date + relativedelta(months=1)
        case RecurringFrequency.quarterly:
            return current_date + relativedelta(months=3)
        case RecurringFrequency.semiannually:
            return current_date + relativedelta(months=6)
        case RecurringFrequency.annually:
            return current_date + relativedelta(years=1)
        case _:
            raise ValueError(f"Unknown frequency: {frequency}")


def rewind_by_frequency(current_date: date, frequency: RecurringFrequency) -> date:
    match frequency:
        case RecurringFrequency.weekly:
            return current_date - relativedelta(weeks=1)
        case RecurringFrequency.biweekly:
            return current_date - relativedelta(weeks=2)
        case RecurringFrequency.monthly:
            return current_date - relativedelta(months=1)
        case RecurringFrequency.quarterly:
            return current_date - relativedelta(months=3)
        case RecurringFrequency.semiannually:
            return current_date - relativedelta(months=6)
        case RecurringFrequency.annually:
            return current_date - relativedelta(years=1)
        case _:
            raise ValueError(f"Unknown frequency: {frequency}")


def first_of_month(d: date) -> date:
    return d.replace(day=1)
