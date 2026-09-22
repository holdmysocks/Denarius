import uuid
from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin


class ShortcutSettings(Base, TimestampMixin):
    """Per-user behaviour of the "Add Transaction" Apple Shortcut.

    The shortcut is generic: it fetches this configuration on every run, so
    changes made in Settings apply without reinstalling it.
    """

    __tablename__ = "shortcut_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    ask_description: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    ask_type: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ask_category: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ask_account: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    default_type: Mapped[str] = mapped_column(String(10), nullable=False, default="expense")
    default_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    auto_category: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # "notify" | "speak" | "none"
    confirmation: Mapped[str] = mapped_column(String(10), nullable=False, default="notify")
