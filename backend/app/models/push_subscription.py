import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class PushSubscription(Base, UUIDMixin):
    """One browser or installed home-screen app that receives Web Push alerts.

    The endpoint is the push service URL the browser handed out (Apple, Google
    or Mozilla); p256dh and auth are the keys used to encrypt each message to
    that browser. A browser re-subscribing with the same endpoint replaces its
    row, so the endpoint is unique.
    """

    __tablename__ = "push_subscriptions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    endpoint: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationLog(Base, UUIDMixin):
    """Alerts already pushed to a user, so each one is sent only once.

    ``key`` names the event, e.g. ``bill:<item id>:<due date>:tomorrow`` or
    ``budget:<budget id>``.
    """

    __tablename__ = "notification_log"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_notification_log_user_key"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
