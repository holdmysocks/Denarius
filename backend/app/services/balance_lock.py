"""Row locking for account balance updates.

Balances are adjusted in Python (``account.current_balance -= amount``). Two
requests that touch the same account at once — a Siri add, an app add and the
auto-post job, say — would each read the same starting balance and the last
writer would silently drop the other's change. Every path that changes a
balance therefore locks the affected account rows first and works from the
locked, freshly read values.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account


async def lock_accounts(db: AsyncSession, *account_ids: uuid.UUID | None) -> None:
    """Take ``FOR UPDATE`` locks on the given accounts and reload their balances.

    Pending changes are flushed first so the reload cannot discard balance
    adjustments made earlier in the same unit of work. Rows are locked in a
    single statement ordered by id, so two requests that both touch accounts A
    and B (e.g. opposite transfers) always acquire them in the same order and
    cannot deadlock each other. Locks are held until the session commits or
    rolls back.
    """
    ids = {account_id for account_id in account_ids if account_id is not None}
    if not ids:
        return
    await db.flush()
    await db.execute(
        select(Account)
        .where(Account.id.in_(ids))
        .order_by(Account.id)
        # FOR NO KEY UPDATE (not FOR UPDATE): inserting a transaction takes a
        # FOR KEY SHARE lock on its account through the foreign key, and
        # FOR UPDATE conflicts with that, deadlocking two concurrent adds.
        # NO KEY UPDATE still serializes balance writers but coexists with
        # the foreign-key locks; it is the lock a plain UPDATE takes anyway.
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
