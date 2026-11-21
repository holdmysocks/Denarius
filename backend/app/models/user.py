import enum
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from app.models.base import Base, UUIDMixin, TimestampMixin


class UserRole(str, enum.Enum):
    admin = "admin"
    member = "member"


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role"), nullable=False, default=UserRole.member
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    theme_dark: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    dashboard_hidden_accounts: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Which push notifications this user wants on their devices.
    push_bills: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    push_budgets: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
