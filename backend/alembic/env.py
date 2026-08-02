import asyncio
import glob
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

from app.config import get_settings
from app.models.base import Base

# When the source tree is bind-mounted from a macOS host on an exFAT volume,
# macOS writes AppleDouble sidecar files (._*) next to every edited file.
# Alembic's revision scanner picks them up as Python files and crashes. Strip
# them defensively before any migrations are loaded.
_versions_dir = os.path.join(os.path.dirname(__file__), "versions")
for _f in glob.glob(os.path.join(_versions_dir, "._*")):
    try:
        os.remove(_f)
    except OSError:
        pass

# Import all models so Alembic can detect them
from app.models import (  # noqa: F401
    user, account, mortgage_detail, category,
    transaction, budget, recurring_item,
    net_worth_snapshot, refresh_token, extra_expense
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    settings = get_settings()
    return settings.DATABASE_URL


def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    url = get_url()
    connectable = async_engine_from_config(
        {"sqlalchemy.url": url},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
