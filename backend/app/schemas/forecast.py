import uuid
from datetime import date as Date
from decimal import Decimal
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field

from app.models.extra_expense import ExtraExpenseFrequency

PositiveMoney = Annotated[Decimal, Field(gt=0)]

ForecastSource = Literal["recurring", "extra", "budget"]


class ExtraExpenseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    amount: PositiveMoney
    frequency: ExtraExpenseFrequency = ExtraExpenseFrequency.monthly
    notes: Optional[str] = None


class ExtraExpenseUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    amount: Optional[PositiveMoney] = None
    frequency: Optional[ExtraExpenseFrequency] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class ExtraExpenseOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    amount: Decimal
    frequency: ExtraExpenseFrequency
    notes: Optional[str] = None
    is_active: bool


class ForecastLine(BaseModel):
    """One contributing row, normalised to monthly and yearly amounts."""

    id: str
    name: str
    source: ForecastSource
    frequency: str
    amount: float
    monthly_amount: float
    yearly_amount: float
    category_name: Optional[str] = None
    account_name: Optional[str] = None


class ForecastGroup(BaseModel):
    key: str
    label: str
    monthly_total: float
    yearly_total: float
    items: list[ForecastLine]


class ForecastOut(BaseModel):
    as_of: Date
    income: ForecastGroup
    expense_groups: list[ForecastGroup]
    income_monthly: float
    income_yearly: float
    expenses_monthly: float
    expenses_yearly: float
    net_monthly: float
    net_yearly: float
    budgets_included: bool
    budget_month: Optional[Date] = None
    # Categories carrying both a budget and an active recurring bill/subscription.
    # Counting both double-counts the same spend, so the UI warns on this.
    budget_overlap_count: int = 0
