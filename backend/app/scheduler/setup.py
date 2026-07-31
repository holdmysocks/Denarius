import logging
from zoneinfo import ZoneInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.database import AsyncSessionLocal, engine
from app.utils.app_date import get_app_timezone

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# This session-level lock elects exactly one scheduler owner even if the backend
# is scaled to multiple containers. The connection must remain open while the
# scheduler is running because PostgreSQL releases the lock on disconnect.
_SCHEDULER_LOCK_ID = 4_443_327_697_859_173_762
_scheduler_lock_connection: AsyncConnection | None = None


def register_jobs(timezone: str | ZoneInfo = "UTC") -> None:
    from app.scheduler.jobs.auto_post_recurring import auto_post_recurring_job
    from app.scheduler.jobs.budget_rollover import budget_rollover_job
    from app.scheduler.jobs.net_worth_snapshot import net_worth_snapshot_job

    scheduler.add_job(
        auto_post_recurring_job,
        CronTrigger(hour=0, minute=5, timezone=timezone),
        id="auto_post_recurring",
        name="Auto-post due recurring items",
        replace_existing=True,
    )
    scheduler.add_job(
        budget_rollover_job,
        CronTrigger(day=1, hour=0, minute=1, timezone=timezone),
        id="budget_rollover",
        name="Mirror current month budgets to next month",
        replace_existing=True,
    )
    scheduler.add_job(
        net_worth_snapshot_job,
        CronTrigger(day=1, hour=1, minute=0, timezone=timezone),
        id="net_worth_snapshot",
        name="Monthly net worth snapshot",
        replace_existing=True,
    )


async def _acquire_scheduler_lock() -> bool:
    global _scheduler_lock_connection

    conn = await engine.connect()
    try:
        acquired = await conn.scalar(
            text("SELECT pg_try_advisory_lock(:lock_id)"),
            {"lock_id": _SCHEDULER_LOCK_ID},
        )
        await conn.commit()
    except Exception:
        await conn.close()
        raise

    if not acquired:
        await conn.close()
        return False

    _scheduler_lock_connection = conn
    return True


async def _release_scheduler_lock() -> None:
    global _scheduler_lock_connection

    conn = _scheduler_lock_connection
    _scheduler_lock_connection = None
    if conn is None:
        return

    try:
        await conn.execute(
            text("SELECT pg_advisory_unlock(:lock_id)"),
            {"lock_id": _SCHEDULER_LOCK_ID},
        )
        await conn.commit()
    finally:
        await conn.close()


async def start_scheduler() -> bool:
    if not await _acquire_scheduler_lock():
        logger.info(
            "Scheduler lock is owned by another backend process; scheduler disabled here"
        )
        return False

    async with AsyncSessionLocal() as db:
        timezone = await get_app_timezone(db)
    register_jobs(timezone)
    try:
        scheduler.start()
    except Exception:
        await _release_scheduler_lock()
        raise
    logger.info("APScheduler started with %d jobs", len(scheduler.get_jobs()))
    return True


def reschedule_jobs(timezone: str | ZoneInfo) -> None:
    """Apply a changed application timezone without requiring a restart."""
    triggers = {
        "auto_post_recurring": CronTrigger(hour=0, minute=5, timezone=timezone),
        "budget_rollover": CronTrigger(day=1, hour=0, minute=1, timezone=timezone),
        "net_worth_snapshot": CronTrigger(day=1, hour=1, minute=0, timezone=timezone),
    }
    for job_id, trigger in triggers.items():
        if scheduler.get_job(job_id) is not None:
            scheduler.reschedule_job(job_id, trigger=trigger)


async def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")
    await _release_scheduler_lock()
