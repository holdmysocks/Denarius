"""The one definition of "money spent" for a date range.

The Dashboard's Monthly Spending card and the Budgets tab both report how much
was spent this month. They used to build their own queries, drifted apart and
showed different totals, so every spending total now comes from here.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionType

# Payments recorded on a mortgage or loan account are principal movements, not
# spending; the matching payment from checking is what counts.
LIABILITY_ACCOUNT_TYPES = (AccountType.mortgage, AccountType.loan)


def spending_filters(
    start: date,
    end: date,
    txn_type: TransactionType = TransactionType.expense,
) -> list[ColumnElement[bool]]:
    """Conditions for visible, non-transfer transactions in ``[start, end)``.

    The caller's query must join ``Account`` on ``Transaction.account_id``.
    """
    return [
        Transaction.type == txn_type,
        Transaction.date >= start,
        Transaction.date < end,
        Transaction.deleted_at == None,  # noqa: E711
        Transaction.is_hidden.is_(False),
        Transaction.transfer_account_id == None,  # noqa: E711
        Account.type.not_in(LIABILITY_ACCOUNT_TYPES),
    ]


async def sum_spending(
    db: AsyncSession,
    start: date,
    end: date,
    *extra: ColumnElement[bool],
    txn_type: TransactionType = TransactionType.expense,
) -> Decimal:
    """Total of matching transactions in ``[start, end)``, narrowed by ``extra``."""
    result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), Decimal("0")))
        .join(Account, Transaction.account_id == Account.id)
        .where(*spending_filters(start, end, txn_type), *extra)
    )
    return result.scalar() or Decimal("0")
