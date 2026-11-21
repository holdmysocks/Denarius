"""Web Push delivery to browsers and home-screen installs.

Denarius signs every push with a VAPID key pair. The pair is generated on first
use and kept in ``app_settings`` so subscriptions survive restarts; rotating it
would silently break every existing subscription, so it is never regenerated.
"""

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01, b64urlencode
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.app_setting import AppSetting
from app.models.push_subscription import PushSubscription
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY_SETTING = "vapid_private_key_pem"

# Push services drop a message they cannot deliver within this many seconds
# (the device was off, say). A day keeps "due tomorrow" alerts meaningful.
PUSH_TTL_SECONDS = 24 * 60 * 60
PUSH_TIMEOUT_SECONDS = 10

# The push service says this subscription is gone for good: the user revoked
# permission, uninstalled the home-screen app or cleared site data.
_GONE_STATUSES = {404, 410}


@dataclass(frozen=True)
class PushMessage:
    title: str
    body: str
    url: str = "/"
    # Notifications with the same tag replace each other on the device.
    tag: str | None = None

    def to_json(self) -> str:
        return json.dumps({"title": self.title, "body": self.body, "url": self.url, "tag": self.tag})


async def _vapid(db: AsyncSession) -> Vapid01:
    pem = await db.scalar(select(AppSetting.value).where(AppSetting.key == VAPID_PRIVATE_KEY_SETTING))
    if pem is None:
        generated = Vapid01()
        generated.generate_keys()
        # Two requests racing on first use must agree on one key, so insert
        # only if absent and read back whichever row won.
        await db.execute(
            pg_insert(AppSetting)
            .values(key=VAPID_PRIVATE_KEY_SETTING, value=generated.private_pem().decode())
            .on_conflict_do_nothing(index_elements=[AppSetting.key])
        )
        await db.commit()
        pem = await db.scalar(select(AppSetting.value).where(AppSetting.key == VAPID_PRIVATE_KEY_SETTING))
    return Vapid01.from_pem(pem.encode())


async def get_public_key(db: AsyncSession) -> str:
    """The application server key browsers need to subscribe (base64url)."""
    vapid = await _vapid(db)
    raw = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return b64urlencode(raw)


async def _vapid_subject(db: AsyncSession) -> str:
    configured = get_settings().VAPID_SUBJECT.strip()
    if configured:
        return configured
    email = await db.scalar(
        select(User.email)
        .where(User.role == UserRole.admin, User.deleted_at.is_(None))
        .order_by(User.created_at)
        .limit(1)
    )
    return f"mailto:{email}" if email else "mailto:admin@localhost"


def _send_one(sub: PushSubscription, payload: str, vapid: Vapid01, subject: str) -> int | None:
    """Deliver one message. Returns the HTTP status of a failure, None on success."""
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=payload,
            vapid_private_key=vapid,
            # webpush mutates the claims dict, so each call gets a fresh one.
            vapid_claims={"sub": subject},
            ttl=PUSH_TTL_SECONDS,
            timeout=PUSH_TIMEOUT_SECONDS,
        )
        return None
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status not in _GONE_STATUSES:
            logger.warning("Push to %s failed: %s", sub.endpoint[:60], exc)
        return status or 0
    except Exception:  # network errors, timeouts
        logger.exception("Push to %s failed", sub.endpoint[:60])
        return 0


async def send_to_user(db: AsyncSession, user_id: uuid.UUID, message: PushMessage) -> int:
    """Push ``message`` to every device the user subscribed. Returns deliveries.

    Subscriptions the push service reports as gone are deleted. The caller
    commits.
    """
    subs = (
        await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id))
    ).scalars().all()
    if not subs:
        return 0

    vapid = await _vapid(db)
    subject = await _vapid_subject(db)
    payload = message.to_json()
    # webpush is a blocking HTTP call; run the devices in parallel off the loop.
    results = await asyncio.gather(
        *(asyncio.to_thread(_send_one, s, payload, vapid, subject) for s in subs)
    )

    delivered = 0
    gone: list[uuid.UUID] = []
    now = datetime.now(timezone.utc)
    for sub, failure in zip(subs, results):
        if failure is None:
            delivered += 1
            sub.last_success_at = now
        elif failure in _GONE_STATUSES:
            gone.append(sub.id)
    if gone:
        await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(gone)))
    return delivered
