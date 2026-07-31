import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal, Optional
from pydantic import BaseModel, Field, model_validator
from app.models.transaction import TransactionType
from app.schemas.category import CategoryOut


class RecurringItemRef(BaseModel):
    model_config = {"from_attributes": True}
    type: str


PositiveMoney = Annotated[Decimal, Field(gt=0)]


class TransactionCreate(BaseModel):
    account_id: uuid.UUID
    category_id: Optional[uuid.UUID] = None
    transfer_account_id: Optional[uuid.UUID] = None
    expense_account_id: Optional[uuid.UUID] = None
    amount: PositiveMoney
    type: TransactionType
    description: Optional[str] = None
    notes: Optional[str] = None
    date: date
    once_per_month_override: Optional[Literal["extra_payment", "next_month_payment"]] = None


# Alias to avoid Python naming conflict: the field name 'date' would shadow
# the 'date' type from datetime when the field has a default of None.
_Date = date


class TransactionUpdate(BaseModel):
    account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    expense_account_id: Optional[uuid.UUID] = None
    amount: Optional[PositiveMoney] = None
    type: Optional[TransactionType] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    date: Optional[_Date] = None
    once_per_month_override: Optional[Literal["extra_payment", "next_month_payment"]] = None

    @model_validator(mode="after")
    def reject_null_for_required_transaction_fields(self):
        """Allow nullable fields to be cleared without nulling database-required fields."""
        required_fields = ("account_id", "amount", "type", "date")
        for field_name in required_fields:
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class TransactionOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    account_id: uuid.UUID
    category_id: Optional[uuid.UUID]
    transfer_account_id: Optional[uuid.UUID]
    recurring_item_id: Optional[uuid.UUID]
    expense_account_id: Optional[uuid.UUID] = None
    paired_transaction_id: Optional[uuid.UUID] = None
    amount: Decimal
    type: TransactionType
    description: Optional[str]
    notes: Optional[str]
    date: date
    category: Optional[CategoryOut] = None
    recurring_item: Optional[RecurringItemRef] = None
    account_name: Optional[str] = None
    account_color: Optional[str] = None
    expense_account_name: Optional[str] = None
    expense_account_color: Optional[str] = None


class BulkDeleteRequest(BaseModel):
    ids: list[uuid.UUID]
