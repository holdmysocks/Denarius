import uuid
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, model_validator
from app.models.account import AccountType
from app.schemas.mortgage import MortgageCreate


class AccountCreate(BaseModel):
    name: str
    type: AccountType
    institution: Optional[str] = None
    account_number: Optional[str] = None
    current_balance: Decimal = Decimal("0.00")
    credit_limit: Optional[Decimal] = None
    sort_order: int = 0
    notes: Optional[str] = None
    color: str = "#6B7280"
    linked_mortgage_id: Optional[uuid.UUID] = None


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[AccountType] = None
    institution: Optional[str] = None
    account_number: Optional[str] = None
    current_balance: Optional[Decimal] = None
    credit_limit: Optional[Decimal] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    notes: Optional[str] = None
    color: Optional[str] = None
    linked_mortgage_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def reject_null_for_required_account_fields(self):
        """Keep explicit null available only for nullable account columns."""
        required_fields = (
            "name",
            "type",
            "current_balance",
            "is_active",
            "sort_order",
            "color",
        )
        for field_name in required_fields:
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class AccountBalanceUpdate(BaseModel):
    balance: Decimal


class AccountOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    type: AccountType
    institution: Optional[str]
    account_number: Optional[str]
    current_balance: Decimal
    initial_balance: Decimal
    credit_limit: Optional[Decimal]
    is_active: bool
    sort_order: int
    notes: Optional[str]
    color: str
    linked_mortgage_id: Optional[uuid.UUID] = None


class NewLinkedMortgage(BaseModel):
    """A mortgage account and its required details created with a property."""

    name: str
    mortgage: MortgageCreate


class AccountWithMortgageCreate(BaseModel):
    account: AccountCreate
    mortgage: Optional[MortgageCreate] = None
    new_linked_mortgage: Optional[NewLinkedMortgage] = None


class AccountWithMortgageUpdate(BaseModel):
    account: AccountUpdate
    mortgage: Optional[MortgageCreate] = None
    new_linked_mortgage: Optional[NewLinkedMortgage] = None
