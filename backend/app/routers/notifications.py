"""Web Push: subscribe a browser or home-screen app, choose alerts, send a test."""

from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.rate_limit import limiter
from app.services import push_service

router = APIRouter(prefix="/notifications", tags=["notifications"])

MAX_SUBSCRIPTIONS_PER_USER = 20

# The backend POSTs to whatever endpoint a browser registers, so only accept
# the real push services instead of letting a user aim it at arbitrary hosts.
PUSH_SERVICE_DOMAINS = (
    "push.apple.com",  # Safari and iOS / iPadOS home-screen apps
    "fcm.googleapis.com",  # Chrome, Edge on Android, Brave, Opera, Samsung
    "android.googleapis.com",
    "push.services.mozilla.com",  # Firefox
    "notify.windows.com",  # Edge on Windows
)


def _is_push_service(endpoint: str) -> bool:
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        return False
    return any(host == d or host.endswith("." + d) for d in PUSH_SERVICE_DOMAINS)


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: SubscriptionKeys

    @field_validator("endpoint")
    @classmethod
    def _known_push_service(cls, value: str) -> str:
        if not _is_push_service(value):
            raise ValueError("endpoint is not a recognised Web Push service")
        return value


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)


class NotificationSettings(BaseModel):
    push_bills: bool
    push_budgets: bool


class NotificationSettingsOut(NotificationSettings):
    device_count: int


class PublicKeyOut(BaseModel):
    public_key: str


class TestResult(BaseModel):
    delivered: int


@router.get("/vapid-public-key", response_model=PublicKeyOut)
async def vapid_public_key(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return PublicKeyOut(public_key=await push_service.get_public_key(db))


@router.post("/subscriptions", status_code=204)
async def subscribe(
    data: SubscriptionIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing_owner = await db.scalar(
        select(PushSubscription.user_id).where(PushSubscription.endpoint == data.endpoint)
    )
    if existing_owner != current_user.id:
        count = await db.scalar(
            select(func.count()).select_from(PushSubscription)
            .where(PushSubscription.user_id == current_user.id)
        )
        if count >= MAX_SUBSCRIPTIONS_PER_USER:
            raise HTTPException(
                status_code=409,
                detail=f"Notifications are already on for {MAX_SUBSCRIPTIONS_PER_USER} devices. "
                       "Turn them off on a device you no longer use first.",
            )

    user_agent = (request.headers.get("user-agent") or "")[:255] or None
    # The same browser re-subscribing (or a shared device after another user
    # signs in) keeps one row, now owned by whoever subscribed last.
    await db.execute(
        pg_insert(PushSubscription)
        .values(
            user_id=current_user.id,
            endpoint=data.endpoint,
            p256dh=data.keys.p256dh,
            auth=data.keys.auth,
            user_agent=user_agent,
        )
        .on_conflict_do_update(
            index_elements=[PushSubscription.endpoint],
            set_={
                "user_id": current_user.id,
                "p256dh": data.keys.p256dh,
                "auth": data.keys.auth,
                "user_agent": user_agent,
                "created_at": datetime.now(timezone.utc),
            },
        )
    )
    await db.commit()


@router.post("/unsubscribe", status_code=204)
async def unsubscribe(
    data: UnsubscribeIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == data.endpoint,
            PushSubscription.user_id == current_user.id,
        )
    )
    await db.commit()


async def _settings_out(db: AsyncSession, user: User) -> NotificationSettingsOut:
    count = await db.scalar(
        select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == user.id)
    )
    return NotificationSettingsOut(
        push_bills=user.push_bills, push_budgets=user.push_budgets, device_count=count or 0
    )


@router.get("/settings", response_model=NotificationSettingsOut)
async def get_notification_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _settings_out(db, current_user)


@router.put("/settings", response_model=NotificationSettingsOut)
async def set_notification_settings(
    data: NotificationSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.push_bills = data.push_bills
    current_user.push_budgets = data.push_budgets
    await db.commit()
    return await _settings_out(db, current_user)


@router.post("/test", response_model=TestResult)
@limiter.limit("5/minute")
async def send_test(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    delivered = await push_service.send_to_user(
        db,
        current_user.id,
        push_service.PushMessage(
            title="Denarius notifications are on",
            body="Bill reminders and budget alerts will show up here.",
            url="/settings",
            tag="denarius-test",
        ),
    )
    await db.commit()
    return TestResult(delivered=delivered)
