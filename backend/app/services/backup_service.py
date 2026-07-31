import asyncio
import gzip
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import get_settings

settings = get_settings()

BACKUP_DIR = Path("/app/backups")


async def run_backup() -> str:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    backup_file = BACKUP_DIR / f"db-{timestamp}-{uuid.uuid4().hex[:8]}.sql.gz"

    pg_password = settings.POSTGRES_PASSWORD or ""
    pg_user = settings.POSTGRES_USER or "denarius"
    pg_db = settings.POSTGRES_DB or "denarius"
    pg_host = settings.POSTGRES_HOST

    env = {**os.environ, "PGPASSWORD": pg_password}
    cmd = ["pg_dump", "-h", pg_host, "-U", pg_user, "-d", pg_db, "--no-password"]

    sql_fd, sql_name = tempfile.mkstemp(
        dir=BACKUP_DIR,
        prefix=f".db-{timestamp}-",
        suffix=".sql",
    )
    gzip_path = Path(f"{sql_name}.gz")

    try:
        with os.fdopen(sql_fd, "wb") as sql_file:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=sql_file,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            _, stderr = await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(f"pg_dump failed: {stderr.decode().strip()}")

        await asyncio.to_thread(_compress_file, Path(sql_name), gzip_path)
        os.replace(gzip_path, backup_file)
    finally:
        Path(sql_name).unlink(missing_ok=True)
        gzip_path.unlink(missing_ok=True)

    _prune_old_backups()
    return str(backup_file)


def _compress_file(source: Path, destination: Path) -> None:
    with source.open("rb") as src, gzip.open(destination, "wb") as dst:
        shutil.copyfileobj(src, dst)


def _prune_old_backups() -> None:
    retain_days = settings.BACKUP_RETAIN_DAYS
    now = datetime.now(timezone.utc).timestamp()
    cutoff = now - (retain_days * 86400)
    for f in BACKUP_DIR.glob("db-*.sql.gz"):
        if f.stat().st_mtime < cutoff:
            f.unlink()


def list_backups() -> list[dict]:
    if not BACKUP_DIR.exists():
        return []
    files = sorted(BACKUP_DIR.glob("db-*.sql.gz"), reverse=True)
    return [
        {
            "filename": f.name,
            "size_bytes": f.stat().st_size,
            "created_at": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
        }
        for f in files
    ]
