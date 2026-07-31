import asyncio
import logging
import subprocess
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import _rate_limit_exceeded_handler
from sqlalchemy import text

from app.config import get_settings
from app.database import engine
from app.rate_limit import limiter
from app.routers import (
    auth, accounts, expense_accounts, mortgage, transactions, categories,
    budgets, recurring, networth, reports, dashboard, users, system,
)
from app.routers import export as export_router_module
from app.scheduler.setup import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

# Session-level PostgreSQL advisory lock used only while Alembic runs. This
# serializes startup migrations when multiple backend containers start together.
_MIGRATION_LOCK_ID = 4_443_327_697_859_173_761


def _run_migrations_subprocess() -> None:
    logger.info("Running Alembic migrations...")
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        logger.error("Migration failed: %s", result.stderr)
        raise RuntimeError(f"Alembic migration failed: {result.stderr}")
    logger.info("Migrations complete")


async def run_migrations() -> None:
    """Run Alembic once at a time across all backend processes."""
    async with engine.connect() as conn:
        await conn.execute(
            text("SELECT pg_advisory_lock(:lock_id)"),
            {"lock_id": _MIGRATION_LOCK_ID},
        )
        await conn.commit()
        try:
            # Do not block the event loop while Alembic runs as a subprocess.
            await asyncio.to_thread(_run_migrations_subprocess)
        finally:
            await conn.execute(
                text("SELECT pg_advisory_unlock(:lock_id)"),
                {"lock_id": _MIGRATION_LOCK_ID},
            )
            await conn.commit()


async def wait_for_db(max_attempts: int = 30, delay_seconds: float = 2.0) -> None:
    """Wait for Postgres to accept connections before running migrations.

    A Portainer/compose restart can start this container before the database is
    ready, which previously crash-looped the backend. Retry a trivial query with
    backoff until the DB answers. Only connectivity is retried here — a genuine
    migration failure still fails fast in run_migrations().
    """
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            logger.info("Database reachable (attempt %d).", attempt)
            return
        except Exception as exc:  # noqa: BLE001 - any connection failure is retryable
            last_err = exc
            logger.warning(
                "Database not ready (attempt %d/%d): %s; retrying in %.1fs",
                attempt, max_attempts, exc, delay_seconds,
            )
            await asyncio.sleep(delay_seconds)
    raise RuntimeError(
        f"Database unreachable after {max_attempts} attempts"
    ) from last_err


@asynccontextmanager
async def lifespan(app: FastAPI):
    await wait_for_db()
    await run_migrations()
    await start_scheduler()
    try:
        yield
    finally:
        await stop_scheduler()


_is_production = settings.ENVIRONMENT == "production"

app = FastAPI(
    title="Denarius",
    description="Self-hosted personal finance tracker API",
    version="0.9.0",
    docs_url=None if _is_production else "/api/docs",
    redoc_url=None if _is_production else "/api/redoc",
    openapi_url=None if _is_production else "/api/openapi.json",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

PREFIX = "/api/v1"
app.include_router(auth.router, prefix=PREFIX)
app.include_router(accounts.router, prefix=PREFIX)
app.include_router(expense_accounts.router, prefix=PREFIX)
app.include_router(mortgage.router, prefix=PREFIX)
app.include_router(transactions.router, prefix=PREFIX)
app.include_router(categories.router, prefix=PREFIX)
app.include_router(budgets.router, prefix=PREFIX)
app.include_router(recurring.router, prefix=PREFIX)
app.include_router(networth.router, prefix=PREFIX)
app.include_router(reports.router, prefix=PREFIX)
app.include_router(dashboard.router, prefix=PREFIX)
app.include_router(users.router, prefix=PREFIX)
app.include_router(system.router, prefix=PREFIX)
app.include_router(export_router_module.router, prefix=PREFIX)
