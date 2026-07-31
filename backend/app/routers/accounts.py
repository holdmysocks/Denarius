import uuid
from collections import defaultdict
from decimal import Decimal
from typing import Optional
from datetime import date, datetime, timezone

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.account import Account, AccountType
from app.models.mortgage_detail import MortgageDetail
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.routers.system import get_app_date
from app.schemas.account import (
    AccountBalanceUpdate,
    AccountCreate,
    AccountOut,
    AccountUpdate,
    AccountWithMortgageCreate,
    AccountWithMortgageUpdate,
    NewLinkedMortgage,
)
from app.schemas.mortgage import MortgageCreate
from app.schemas.transaction import TransactionOut
from app.utils.pagination import PagedResponse

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountOut])
async def list_accounts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Account)
        .where(Account.is_active == True, Account.deleted_at == None)
        .order_by(Account.sort_order, Account.name)
    )
    return result.scalars().all()


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(
    data: AccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account_data = data.model_dump()
    await _validate_account_relationship(
        account_data["type"], account_data.get("linked_mortgage_id"), db
    )
    # On creation there are no transactions yet, so initial_balance equals current_balance
    account_data["initial_balance"] = account_data["current_balance"]
    account = Account(**account_data)
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.post("/with-mortgage", response_model=AccountOut, status_code=201)
async def create_account_with_mortgage(
    data: AccountWithMortgageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create an account and any mortgage records in one database transaction."""
    account_data = data.account.model_dump()
    await _validate_bundle(
        account_type=account_data["type"],
        linked_mortgage_id=account_data.get("linked_mortgage_id"),
        mortgage=data.mortgage,
        new_linked_mortgage=data.new_linked_mortgage,
        db=db,
    )

    account_data["initial_balance"] = account_data["current_balance"]
    account = Account(**account_data)
    db.add(account)

    if data.new_linked_mortgage is not None:
        linked_account = await _create_linked_mortgage(data.new_linked_mortgage, db)
        account.linked_mortgage_id = linked_account.id

    await db.flush()
    if data.mortgage is not None:
        await _upsert_mortgage_details(account.id, data.mortgage, db)

    await db.commit()
    await db.refresh(account)
    return account


@router.get("/balance-history")
async def get_balance_history(
    days: int = Query(365, ge=7, le=730),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from datetime import timedelta

    today = await get_app_date(db)

    # ≤90 days → daily granularity; >90 days → monthly (approximate months from days)
    if days <= 90:
        granularity = "daily"
        date_points = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
        labels = [d.strftime("%Y-%m-%d") for d in date_points]
        oldest_cutoff = date_points[0]
    else:
        granularity = "monthly"
        approx_months = max(1, round(days / 30))
        current_month_start = today.replace(day=1)
        month_starts = [current_month_start - relativedelta(months=i) for i in range(approx_months - 1, -1, -1)]
        # Use last day of each month as the date point (today for the current month)
        date_points = []
        for i, ms in enumerate(month_starts):
            if i == len(month_starts) - 1:
                date_points.append(today)
            else:
                date_points.append(month_starts[i + 1] - timedelta(days=1))
        labels = [ms.strftime("%Y-%m") for ms in month_starts]
        oldest_cutoff = month_starts[0]

    acct_result = await db.execute(
        select(Account)
        .where(Account.is_active == True, Account.deleted_at == None)
        .order_by(Account.sort_order, Account.name)
    )
    accounts = acct_result.scalars().all()

    if not accounts:
        return {"granularity": granularity, "dates": [], "accounts": []}

    account_ids = [a.id for a in accounts]

    txn_result = await db.execute(
        select(Transaction.account_id, Transaction.amount, Transaction.type, Transaction.date)
        .where(
            Transaction.deleted_at == None,
            Transaction.date >= oldest_cutoff,
            Transaction.account_id.in_(account_ids),
        )
    )
    transactions = txn_result.all()

    txns_by_account: dict = defaultdict(list)
    for txn in transactions:
        txns_by_account[txn.account_id].append(txn)

    result_accounts = []
    for account in accounts:
        account_txns = txns_by_account.get(account.id, [])
        current_bal = float(account.current_balance)

        balances = []
        for date_point in date_points:
            adjustment = 0.0
            for txn in account_txns:
                if txn.date > date_point:
                    if txn.type == TransactionType.income:
                        adjustment -= float(txn.amount)
                    else:
                        adjustment += float(txn.amount)
            balances.append(round(current_bal + adjustment, 2))

        result_accounts.append({
            "id": str(account.id),
            "name": account.name,
            "type": account.type,
            "color": account.color,
            "balances": balances,
        })

    return {
        "granularity": granularity,
        "dates": labels,
        "accounts": result_accounts,
    }


@router.get("/{account_id}", response_model=AccountOut)
async def get_account(
    account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await _get_or_404(account_id, db)
    return account


@router.put("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: uuid.UUID,
    data: AccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await _get_or_404(account_id, db)
    updates = data.model_dump(exclude_unset=True)
    effective_type = updates.get("type", account.type)
    effective_linked_mortgage_id = updates.get(
        "linked_mortgage_id", account.linked_mortgage_id
    )
    await _validate_account_relationship(
        effective_type, effective_linked_mortgage_id, db, account_id=account.id
    )
    await _validate_existing_mortgage_type(account, effective_type, db)
    if "current_balance" in updates:
        await _create_balance_adjustment(
            account, Decimal(str(updates.pop("current_balance"))), current_user.id, db
        )
    for field, value in updates.items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return account


@router.put("/{account_id}/with-mortgage", response_model=AccountOut)
async def update_account_with_mortgage(
    account_id: uuid.UUID,
    data: AccountWithMortgageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an account, mortgage details, and property link atomically."""
    account = await _get_or_404(account_id, db)
    updates = data.account.model_dump(exclude_unset=True)
    effective_type = updates.get("type", account.type)
    effective_linked_mortgage_id = updates.get(
        "linked_mortgage_id", account.linked_mortgage_id
    )
    await _validate_bundle(
        account_type=effective_type,
        linked_mortgage_id=effective_linked_mortgage_id,
        mortgage=data.mortgage,
        new_linked_mortgage=data.new_linked_mortgage,
        db=db,
        account_id=account.id,
    )
    await _validate_existing_mortgage_type(account, effective_type, db)

    if "current_balance" in updates:
        await _create_balance_adjustment(
            account, Decimal(str(updates.pop("current_balance"))), current_user.id, db
        )
    for field, value in updates.items():
        setattr(account, field, value)

    if data.new_linked_mortgage is not None:
        linked_account = await _create_linked_mortgage(data.new_linked_mortgage, db)
        account.linked_mortgage_id = linked_account.id

    await db.flush()
    if data.mortgage is not None:
        await _upsert_mortgage_details(account.id, data.mortgage, db)

    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
async def delete_account(
    account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await _get_or_404(account_id, db)

    # Block deletion of a property that still has a linked mortgage
    if account.linked_mortgage_id is not None:
        raise HTTPException(
            status_code=409,
            detail="This property has a linked mortgage. Unlink it first before deleting.",
        )

    # Block deletion of a mortgage that a property is still linked to
    linked_result = await db.execute(
        select(Account).where(
            Account.linked_mortgage_id == account_id,
            Account.deleted_at == None,
        )
    )
    if linked_result.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="This mortgage is linked to a property. Unlink it first before deleting.",
        )

    account.deleted_at = datetime.now(timezone.utc)
    account.is_active = False
    await db.commit()


@router.put("/{account_id}/balance", response_model=AccountOut)
async def update_balance(
    account_id: uuid.UUID,
    data: AccountBalanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = await _get_or_404(account_id, db)
    await _create_balance_adjustment(account, data.balance, current_user.id, db)
    await db.commit()
    await db.refresh(account)
    return account


@router.post("/{account_id}/recalculate", response_model=AccountOut)
async def recalculate_balance(
    account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recompute current_balance from initial_balance + sum(transactions).
    Use this to recover from any balance drift or data corruption."""
    account = await _get_or_404(account_id, db)
    txn_sum = await _get_transaction_sum(account_id, db)
    account.current_balance = account.initial_balance + txn_sum
    await db.commit()
    await db.refresh(account)
    return account


@router.get("/{account_id}/transactions", response_model=PagedResponse[TransactionOut])
async def get_account_transactions(
    account_id: uuid.UUID,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_or_404(account_id, db)
    offset = (page - 1) * limit
    base = select(Transaction).where(Transaction.account_id == account_id, Transaction.deleted_at == None, Transaction.is_hidden != True)
    total_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_result.scalar()
    result = await db.execute(base.order_by(Transaction.date.desc()).offset(offset).limit(limit))
    items = result.scalars().all()
    return PagedResponse(items=items, total=total, page=page, pages=-(-total // limit), limit=limit)


async def _get_or_404(account_id: uuid.UUID, db: AsyncSession) -> Account:
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.deleted_at == None)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


async def _validate_account_relationship(
    account_type: AccountType,
    linked_mortgage_id: uuid.UUID | None,
    db: AsyncSession,
    account_id: uuid.UUID | None = None,
) -> None:
    if linked_mortgage_id is None:
        return
    if account_type != AccountType.property:
        raise HTTPException(
            status_code=422,
            detail="Only property accounts can link to a mortgage account.",
        )
    if linked_mortgage_id == account_id:
        raise HTTPException(status_code=422, detail="An account cannot link to itself.")

    result = await db.execute(
        select(Account).where(
            Account.id == linked_mortgage_id,
            Account.type == AccountType.mortgage,
            Account.is_active == True,
            Account.deleted_at == None,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=422,
            detail="Linked mortgage account was not found or is inactive.",
        )


async def _validate_bundle(
    account_type: AccountType,
    linked_mortgage_id: uuid.UUID | None,
    mortgage: MortgageCreate | None,
    new_linked_mortgage: NewLinkedMortgage | None,
    db: AsyncSession,
    account_id: uuid.UUID | None = None,
) -> None:
    if mortgage is not None and account_type not in {
        AccountType.mortgage,
        AccountType.loan,
    }:
        raise HTTPException(
            status_code=422,
            detail="Mortgage details require a mortgage or loan account.",
        )
    if new_linked_mortgage is not None:
        if account_type != AccountType.property:
            raise HTTPException(
                status_code=422,
                detail="A linked mortgage can only be created for a property account.",
            )
        if linked_mortgage_id is not None:
            raise HTTPException(
                status_code=422,
                detail="Choose either an existing mortgage or create a new one, not both.",
            )
        if not new_linked_mortgage.name.strip():
            raise HTTPException(status_code=422, detail="Mortgage account name is required.")
    await _validate_account_relationship(
        account_type, linked_mortgage_id, db, account_id=account_id
    )


async def _validate_existing_mortgage_type(
    account: Account, effective_type: AccountType, db: AsyncSession
) -> None:
    if effective_type in {AccountType.mortgage, AccountType.loan}:
        return
    result = await db.execute(
        select(MortgageDetail.id).where(MortgageDetail.account_id == account.id)
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail="This account has mortgage details and must remain a mortgage or loan.",
        )


async def _create_linked_mortgage(
    data: NewLinkedMortgage, db: AsyncSession
) -> Account:
    principal = data.mortgage.original_principal
    account = Account(
        name=data.name.strip(),
        type=AccountType.mortgage,
        current_balance=-principal,
        initial_balance=-principal,
    )
    db.add(account)
    await db.flush()
    db.add(MortgageDetail(account_id=account.id, **data.mortgage.model_dump()))
    return account


async def _upsert_mortgage_details(
    account_id: uuid.UUID, data: MortgageCreate, db: AsyncSession
) -> None:
    result = await db.execute(
        select(MortgageDetail).where(MortgageDetail.account_id == account_id)
    )
    mortgage = result.scalar_one_or_none()
    values = data.model_dump()
    if mortgage is None:
        db.add(MortgageDetail(account_id=account_id, **values))
        return
    for field, value in values.items():
        setattr(mortgage, field, value)


async def _create_balance_adjustment(
    account: Account, desired_balance: Decimal, user_id: uuid.UUID, db: AsyncSession
) -> None:
    """Create a hidden adjustment transaction to reconcile account balance."""
    delta = desired_balance - account.current_balance
    if delta == 0:
        return
    today = await get_app_date(db)
    txn_type = TransactionType.income if delta > 0 else TransactionType.expense
    adjustment_txn = Transaction(
        account_id=account.id,
        amount=abs(delta),
        type=txn_type,
        is_hidden=True,
        description="Balance adjustment",
        date=today,
        created_by=user_id,
    )
    db.add(adjustment_txn)
    account.current_balance = desired_balance


async def _get_transaction_sum(account_id: uuid.UUID, db: AsyncSession) -> Decimal:
    """Sum all non-deleted transactions for an account: income → +amount, else → -amount."""
    result = await db.execute(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (Transaction.type == TransactionType.income, Transaction.amount),
                        else_=-Transaction.amount,
                    )
                ),
                Decimal("0"),
            )
        ).where(
            Transaction.account_id == account_id,
            Transaction.deleted_at == None,
        )
    )
    return result.scalar() or Decimal("0")
