from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_admin
from app.models.app_setting import AppSetting
from app.models.user import User
from app.scheduler.setup import reschedule_jobs, scheduler
from app.services.backup_service import list_backups, run_backup
from app.utils.app_date import _TZ_KEY, get_app_date, parse_timezone  # noqa: F401  (re-exported)

router = APIRouter(prefix="/system", tags=["system"])


class TimezoneUpdate(BaseModel):
    timezone: str

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        parse_timezone(value)
        return value


@router.get("/timezone")
async def get_timezone(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    row = await db.scalar(select(AppSetting).where(AppSetting.key == _TZ_KEY))
    return {"timezone": row.value if row else None}


@router.put("/timezone")
async def set_timezone(
    data: TimezoneUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    row = await db.scalar(select(AppSetting).where(AppSetting.key == _TZ_KEY))
    if row:
        row.value = data.timezone
    else:
        db.add(AppSetting(key=_TZ_KEY, value=data.timezone))
    await db.commit()
    if scheduler.running:
        reschedule_jobs(data.timezone)
    return {"timezone": data.timezone}


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "error", "db": "error"},
        ) from exc
    return {"status": "ok", "db": "ok"}


@router.get("/backups")
async def get_backups(admin: User = Depends(require_admin)):
    return list_backups()


@router.post("/backup")
async def trigger_backup(admin: User = Depends(require_admin)):
    path = await run_backup()
    return {"message": "Backup completed", "path": path}


@router.get("/jobs")
async def get_jobs(admin: User = Depends(require_admin)):
    jobs = scheduler.get_jobs()
    return [
        {
            "id": job.id,
            "name": job.name,
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
        }
        for job in jobs
    ]
