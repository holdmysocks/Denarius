import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Optional
from pydantic import BaseModel, Field
from app.schemas.category import CategoryOut


PositiveMoney = Annotated[Decimal, Field(gt=0)]


class BudgetCreate(BaseModel):
    category_id: uuid.UUID
    month: date
    amount: PositiveMoney


class BudgetUpdate(BaseModel):
    amount: PositiveMoney


class BudgetOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    category_id: uuid.UUID
    month: date
    amount: float
    category: Optional[CategoryOut] = None


class BudgetWithSpent(BudgetOut):
    actual_spent: float
    remaining: float
    is_over_budget: bool


class BudgetSummary(BaseModel):
    total_budgeted: float
    total_spent: float
    uncategorized_spent: float
    over_budget_categories: list[BudgetWithSpent]


class CopyMonthRequest(BaseModel):
    from_month: date
    to_month: date
    overwrite: bool = False


class MonthlyTargetOut(BaseModel):
    month: date
    amount: float


class MonthlyTargetSet(BaseModel):
    month: date
    amount: PositiveMoney


class BudgetPrefsOut(BaseModel):
    keep_for_next_month: bool


class BudgetPrefsUpdate(BaseModel):
    keep_for_next_month: bool
