import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Optional
from pydantic import BaseModel, Field, model_validator


PositiveMoney = Annotated[Decimal, Field(gt=0)]
NonNegativeMoney = Annotated[Decimal, Field(ge=0)]
NonNegativeRate = Annotated[Decimal, Field(ge=0)]
PositiveTerm = Annotated[int, Field(gt=0)]


class MortgageCreate(BaseModel):
    original_principal: PositiveMoney
    interest_rate: NonNegativeRate
    term_months: PositiveTerm
    start_date: date
    extra_payment: NonNegativeMoney = Decimal("0.00")
    loan_type: Optional[str] = None


class MortgageUpdate(BaseModel):
    original_principal: Optional[PositiveMoney] = None
    interest_rate: Optional[NonNegativeRate] = None
    term_months: Optional[PositiveTerm] = None
    start_date: Optional[date] = None
    extra_payment: Optional[NonNegativeMoney] = None
    loan_type: Optional[str] = None

    @model_validator(mode="after")
    def reject_null_for_required_mortgage_fields(self):
        """Permit clearing loan_type without nulling required mortgage columns."""
        required_fields = (
            "original_principal",
            "interest_rate",
            "term_months",
            "start_date",
            "extra_payment",
        )
        for field_name in required_fields:
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class MortgageOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    account_id: uuid.UUID
    original_principal: Decimal
    interest_rate: Decimal
    term_months: int
    start_date: date
    extra_payment: Decimal
    loan_type: Optional[str] = None


class AmortizationRow(BaseModel):
    payment_number: int
    payment_date: date
    payment_amount: Decimal
    principal: Decimal
    interest: Decimal
    balance: Decimal
    cumulative_interest: Decimal


class ExtraPaymentCalcRequest(BaseModel):
    extra_monthly: NonNegativeMoney


class ExtraPaymentCalcResult(BaseModel):
    months_saved: int
    interest_saved: Decimal
    new_payoff_date: date


class MortgagePaymentCreate(BaseModel):
    source_account_id: uuid.UUID
    source_amount: PositiveMoney
    mortgage_amount: PositiveMoney
    date: date
    description: Optional[str] = None


class MortgagePaymentResult(BaseModel):
    source_transaction_id: uuid.UUID
    mortgage_transaction_id: uuid.UUID
