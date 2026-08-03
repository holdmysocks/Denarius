import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, UUIDMixin, TimestampMixin


class RecurringType(str, enum.Enum):
    subscription = "subscription"
    bill = "bill"
    income = "income"


class RecurringFrequency(str, enum.Enum):
    weekly = "weekly"
    biweekly = "biweekly"
    monthly = "monthly"
    quarterly = "quarterly"
    semiannually = "semiannually"
    annually = "annually"


class RecurringItem(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "recurring_items"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=False
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    amount_min: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    amount_max: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    type: Mapped[RecurringType] = mapped_column(
        Enum(RecurringType, name="recurring_type"), nullable=False
    )
    frequency: Mapped[RecurringFrequency] = mapped_column(
        Enum(RecurringFrequency, name="recurring_frequency"), nullable=False
    )
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    auto_post: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    auto_match: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    keyword_match: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_paid_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_paid_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    last_paid_transaction_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    expense_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expense_accounts.id", ondelete="SET NULL"), nullable=True
    )

    account: Mapped["Account"] = relationship("Account")
    category: Mapped["Category"] = relationship("Category")
    expense_account: Mapped["ExpenseAccount"] = relationship("ExpenseAccount")
