import logging
from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services.recurring_service import auto_post_due_items

logger = logging.getLogger(__name__)

# Defense in depth for manual invocation, scheduler failover, or an accidental
# second scheduler. The transaction-level lock is released by commit/rollback.
_AUTO_POST_LOCK_ID = 4_443_327_697_859_173_763


async def auto_post_recurring_job() -> None:
    async with AsyncSessionLocal() as db:
        try:
            acquired = await db.scalar(
                text("SELECT pg_try_advisory_xact_lock(:lock_id)"),
                {"lock_id": _AUTO_POST_LOCK_ID},
            )
            if not acquired:
                logger.info("Auto-post already running in another process; skipping")
                await db.rollback()
                return

            posted = await auto_post_due_items(db)
            logger.info("Auto-posted %d recurring items", posted)
        except Exception:
            await db.rollback()
            logger.exception("Error in auto_post_recurring_job")
