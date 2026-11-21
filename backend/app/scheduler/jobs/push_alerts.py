import logging

from app.database import AsyncSessionLocal
from app.services.alert_service import send_pending_alerts
from app.utils.app_date import get_app_date

logger = logging.getLogger(__name__)


async def push_alerts_job() -> None:
    async with AsyncSessionLocal() as db:
        try:
            sent = await send_pending_alerts(db, await get_app_date(db))
            if sent:
                logger.info("Push alerts: sent %d", sent)
        except Exception:
            logger.exception("Error in push_alerts_job")
