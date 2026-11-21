from decimal import Decimal
from typing import Annotated

from pydantic import Field

# Money columns are Numeric(15, 2): at most 13 digits before the decimal point.
# Rejecting larger values in validation returns a 422 instead of letting the
# database raise a numeric overflow (HTTP 500).
MAX_MONEY = Decimal("9999999999999.99")

PositiveMoney = Annotated[Decimal, Field(gt=0, le=MAX_MONEY)]
