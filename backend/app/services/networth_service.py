from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountType
from app.models.net_worth_snapshot import NetWorthSnapshot
from app.schemas.net_worth import AccountBreakdownItem, NetWorthCurrent
from app.utils.app_date import get_app_date

ASSET_TYPES = {
    AccountType.checking,
    AccountType.savings,
    AccountType.investment,
    AccountType.property,
    AccountType.cash,
}
LIABILITY_TYPES = {AccountType.credit_card, AccountType.mortgage, AccountType.loan}


def classify_account_balance(
    account_type: AccountType, balance: Decimal
) -> tuple[bool, Decimal]:
    """Return whether an account is an asset and its display/aggregate value."""
    if account_type in ASSET_TYPES:
        return True, balance
    if account_type in LIABILITY_TYPES:
        return False, abs(balance)

    # "other" has no fixed accounting convention, so its sign determines how
    # it contributes to net worth and where it appears in the breakdown.
    if balance < 0:
        return False, abs(balance)
    return True, balance


async def get_current_net_worth(db: AsyncSession) -> NetWorthCurrent:
    result = await db.execute(
        select(Account).where(Account.is_active == True, Account.deleted_at == None)
    )
    accounts = result.scalars().all()

    assets = Decimal("0.00")
    liabilities = Decimal("0.00")
    breakdown = []

    for acc in accounts:
        balance = acc.current_balance
        is_asset, item_balance = classify_account_balance(acc.type, balance)

        if is_asset:
            assets += item_balance
        else:
            liabilities += item_balance

        item = AccountBreakdownItem(
            account_id=str(acc.id),
            account_name=acc.name,
            account_type=acc.type.value,
            balance=item_balance,
            is_asset=is_asset,
        )
        breakdown.append(item)

    return NetWorthCurrent(
        total_assets=assets,
        total_liabilities=liabilities,
        net_worth=assets - liabilities,
        accounts=breakdown,
    )


async def create_snapshot(db: AsyncSession, snapshot_date: date | None = None) -> NetWorthSnapshot:
    if snapshot_date is None:
        snapshot_date = (await get_app_date(db)).replace(day=1)

    current = await get_current_net_worth(db)

    existing = await db.execute(
        select(NetWorthSnapshot).where(NetWorthSnapshot.snapshot_date == snapshot_date)
    )
    snap = existing.scalar_one_or_none()

    if snap:
        snap.total_assets = current.total_assets
        snap.total_liabilities = current.total_liabilities
        snap.net_worth = current.net_worth
        snap.account_breakdown = [a.model_dump() for a in current.accounts]
    else:
        snap = NetWorthSnapshot(
            snapshot_date=snapshot_date,
            total_assets=current.total_assets,
            total_liabilities=current.total_liabilities,
            net_worth=current.net_worth,
            account_breakdown=[a.model_dump() for a in current.accounts],
        )
        db.add(snap)

    await db.commit()
    await db.refresh(snap)
    return snap
