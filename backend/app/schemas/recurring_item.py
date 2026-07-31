import uuid
from datetime import date as Date
from decimal import Decimal
from typing import Annotated, Optional
from pydantic import BaseModel, Field, model_validator
from app.models.recurring_item import RecurringFrequency, RecurringType


PositiveMoney = Annotated[Decimal, Field(gt=0)]


class RecurringCreate(BaseModel):
    name: str
    account_id: uuid.UUID
    category_id: Optional[uuid.UUID] = None
    amount: PositiveMoney
    amount_min: Optional[PositiveMoney] = None
    amount_max: Optional[PositiveMoney] = None
    type: RecurringType
    frequency: RecurringFrequency
    day_of_month: Optional[int] = None
    next_due_date: Date
    auto_post: bool = False
    auto_match: bool = False
    keyword_match: Optional[str] = None
    notes: Optional[str] = None
    expense_account_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def validate_amount_range(self):
        if (
            self.amount_min is not None
            and self.amount_max is not None
            and self.amount_min > self.amount_max
        ):
            raise ValueError("amount_min cannot be greater than amount_max")
        return self


class RecurringUpdate(BaseModel):
    name: Optional[str] = None
    account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    amount: Optional[PositiveMoney] = None
    amount_min: Optional[PositiveMoney] = None
    amount_max: Optional[PositiveMoney] = None
    type: Optional[RecurringType] = None
    frequency: Optional[RecurringFrequency] = None
    day_of_month: Optional[int] = None
    next_due_date: Optional[Date] = None
    auto_post: Optional[bool] = None
    auto_match: Optional[bool] = None
    keyword_match: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None
    expense_account_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def reject_null_for_required_recurring_fields(self):
        required_fields = (
            "name",
            "account_id",
            "amount",
            "type",
            "frequency",
            "next_due_date",
            "auto_post",
            "auto_match",
            "is_active",
        )
        for field_name in required_fields:
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class RecurringOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    account_id: uuid.UUID
    category_id: Optional[uuid.UUID]
    amount: Decimal
    amount_min: Optional[Decimal] = None
    amount_max: Optional[Decimal] = None
    type: RecurringType
    frequency: RecurringFrequency
    day_of_month: Optional[int]
    next_due_date: Date
    auto_post: bool
    auto_match: bool
    keyword_match: Optional[str] = None
    is_active: bool
    notes: Optional[str]
    days_until_due: Optional[int] = None
    last_paid_date: Optional[Date] = None
    last_paid_amount: Optional[Decimal] = None
    last_paid_transaction_id: Optional[uuid.UUID] = None
    is_paid_current_period: bool = False
    expected_payments_this_month: int = 1
    paid_payments_this_month: int = 0
    expense_account_id: Optional[uuid.UUID] = None


class MarkPaidRequest(BaseModel):
    date: Optional[Date] = None
    amount: Optional[PositiveMoney] = None
    description: Optional[str] = None
    account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    source_account_id: Optional[uuid.UUID] = None


class MarkPaidNoTransactionRequest(BaseModel):
    date: Optional[Date] = None
    amount: Optional[PositiveMoney] = None


class RecurringSummaryOut(BaseModel):
    """Summary of paid and expected amounts for recurring items in the current month."""
    subscriptions_paid: float
    subscriptions_count: int
    subscriptions_expected: float
    subscriptions_total: int
    bills_paid: float
    bills_count: int
    bills_expected: float
    bills_total: int
    income_paid: float
    income_count: int
    income_expected: float
    income_total: int
