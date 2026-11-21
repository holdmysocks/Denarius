"""Decide which push alerts are due and send each one once per user.

Alerts mirror the in-app notification bell: bills and subscriptions coming
due, and categories that went over budget. The scheduler runs
``send_pending_alerts`` every hour during the day; ``notification_log`` keeps a
row per alert sent, so re-running never repeats one.
"""

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.push_subscription import NotificationLog, PushSubscription
from app.models.recurring_item import RecurringItem, RecurringType
from app.models.user import User
from app.routers.budgets import _budgets_with_spent
from app.services.push_service import PushMessage, send_to_user

logger = logging.getLogger(__name__)

# days until due -> (stage used in the dedupe key, wording)
_BILL_STAGES = {1: ("tomorrow", "due tomorrow"), 0: ("today", "due today"), -1: ("overdue", "overdue")}


@dataclass(frozen=True)
class Alert:
    key: str
    kind: str  # "bill" | "budget"
    message: PushMessage


def _money(amount: Decimal) -> str:
    return f"${amount:,.2f}"


async def collect_alerts(db: AsyncSession, today: date) -> list[Alert]:
    """Every alert that applies today, before per-user filtering."""
    alerts: list[Alert] = []

    items = (
        await db.execute(
            select(RecurringItem).where(
                RecurringItem.is_active.is_(True),
                RecurringItem.deleted_at.is_(None),
                RecurringItem.type != RecurringType.income,
                RecurringItem.next_due_date >= today - timedelta(days=1),
                RecurringItem.next_due_date <= today + timedelta(days=1),
            )
        )
    ).scalars().all()
    for item in items:
        stage, wording = _BILL_STAGES[(item.next_due_date - today).days]
        alerts.append(Alert(
            key=f"bill:{item.id}:{item.next_due_date.isoformat()}:{stage}",
            kind="bill",
            message=PushMessage(
                title=f"{item.name} is {wording}",
                body=f"{_money(item.amount)} · {item.next_due_date.strftime('%b %-d')}",
                url="/recurring",
                tag=f"bill-{item.id}",
            ),
        ))

    for budget in await _budgets_with_spent(today, db):
        if not budget.is_over_budget:
            continue
        name = budget.category.name if budget.category else "A category"
        alerts.append(Alert(
            # One budget row exists per category per month, so this fires at
            # most once a month for each category.
            key=f"budget:{budget.id}",
            kind="budget",
            message=PushMessage(
                title=f"{name} is over budget",
                body=f"{_money(budget.actual_spent)} spent of {_money(budget.amount)}",
                url="/budgets",
                tag=f"budget-{budget.id}",
            ),
        ))
    return alerts


async def send_pending_alerts(db: AsyncSession, today: date) -> int:
    """Push every alert a subscribed user has not had yet. Returns pushes sent."""
    alerts = await collect_alerts(db, today)
    if not alerts:
        return 0

    users = (
        await db.execute(
            select(User)
            .where(
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                User.id.in_(select(PushSubscription.user_id)),
            )
        )
    ).scalars().all()

    sent = 0
    for user in users:
        wanted = [
            a for a in alerts
            if (a.kind == "bill" and user.push_bills) or (a.kind == "budget" and user.push_budgets)
        ]
        if not wanted:
            continue
        already = set(
            (
                await db.execute(
                    select(NotificationLog.key).where(
                        NotificationLog.user_id == user.id,
                        NotificationLog.key.in_([a.key for a in wanted]),
                    )
                )
            ).scalars()
        )
        for alert in wanted:
            if alert.key in already:
                continue
            delivered = await send_to_user(db, user.id, alert.message)
            # Only record alerts that reached a device, so a push service
            # outage is retried on the next run instead of being lost.
            if delivered:
                await db.execute(
                    pg_insert(NotificationLog)
                    .values(user_id=user.id, key=alert.key)
                    .on_conflict_do_nothing(constraint="uq_notification_log_user_key")
                )
                sent += 1
            await db.commit()
    return sent
