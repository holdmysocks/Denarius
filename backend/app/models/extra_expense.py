import enum
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, UUIDMixin, TimestampMixin


class ExtraExpenseFrequency(str, enum.Enum):
    monthly = "monthly"
    yearly = "yearly"


class ExtraExpense(Base, UUIDMixin, TimestampMixin):
    """A manually entered running cost that has no recurring item behind it.

    These never post transactions — they exist purely to make the forecast
    totals honest (gas, groceries, "misc", …).
    """

    __tablename__ = "extra_expenses"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    frequency: Mapped[ExtraExpenseFrequency] = mapped_column(
        Enum(ExtraExpenseFrequency, name="extra_expense_frequency"),
        nullable=False,
        default=ExtraExpenseFrequency.monthly,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
