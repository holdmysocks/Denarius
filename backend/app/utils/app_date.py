from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting

_TZ_KEY = "timezone"


def parse_timezone(timezone_name: str | None) -> ZoneInfo:
    """Validate an IANA timezone name, falling back to UTC only when unset."""
    if not timezone_name:
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timezone: {timezone_name}") from exc


async def get_app_timezone(db: AsyncSession) -> ZoneInfo:
    row = await db.scalar(select(AppSetting).where(AppSetting.key == _TZ_KEY))
    return parse_timezone(row.value if row else None)


async def get_app_date(db: AsyncSession) -> date:
    """Return today's date in the app-configured timezone."""
    tz = await get_app_timezone(db)
    return datetime.now(tz).date()
