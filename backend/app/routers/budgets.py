import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db
from app.models.account import Account, AccountType
from app.models.app_setting import AppSetting
from app.models.budget import Budget
from app.routers.system import get_app_date
from app.models.category import Category
from app.models.monthly_budget_total import MonthlyBudgetTotal
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.schemas.budget import (
    BudgetCreate,
    BudgetOut,
    BudgetPrefsOut,
    BudgetPrefsUpdate,
    BudgetSummary,
    BudgetUpdate,
    BudgetWithSpent,
    CopyMonthRequest,
    MonthlyTargetOut,
    MonthlyTargetSet,
)
from app.services import budget_sync
from app.utils.date_utils import first_of_month

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _budgets_with_spent(month: date, db: AsyncSession) -> list[BudgetWithSpent]:
    month_start = first_of_month(month)
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1, day=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)

    result = await db.execute(
        select(Budget).options(selectinload(Budget.category))
        .where(Budget.month == month_start)
    )
    budgets = result.scalars().all()

    out = []
    for b in budgets:
        spent_result = await db.execute(
            select(func.coalesce(func.sum(Transaction.amount), Decimal("0")))
            .join(Account, Transaction.account_id == Account.id)
            .where(
                Transaction.category_id == b.category_id,
                Transaction.type == TransactionType.expense,
                Transaction.date >= month_start,
                Transaction.date < month_end,
                Transaction.deleted_at == None,
                Transaction.is_hidden.is_(False),
                Transaction.transfer_account_id == None,
                Account.type.not_in([AccountType.mortgage, AccountType.loan]),
            )
        )
        actual_spent = spent_result.scalar() or Decimal("0")
        remaining = b.amount - actual_spent
        out.append(BudgetWithSpent(
            id=b.id,
            category_id=b.category_id,
            month=b.month,
            amount=b.amount,
            category=b.category,
            actual_spent=actual_spent,
            remaining=remaining,
            is_over_budget=actual_spent > b.amount,
        ))
    return out


@router.get("", response_model=list[BudgetWithSpent])
async def list_budgets(
    month: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_month = month or await get_app_date(db)
    return await _budgets_with_spent(target_month, db)


@router.post("", response_model=BudgetOut, status_code=201)
async def create_or_update_budget(
    data: BudgetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    month_start = first_of_month(data.month)
    existing = await db.execute(
        select(Budget).where(Budget.category_id == data.category_id, Budget.month == month_start)
    )
    budget = existing.scalar_one_or_none()
    if budget:
        budget.amount = data.amount
    else:
        budget = Budget(category_id=data.category_id, month=month_start, amount=data.amount)
        db.add(budget)
    await db.commit()

    if await budget_sync.is_keep_enabled(db) and await budget_sync.is_current_month(db, month_start):
        await budget_sync.upsert_category_budget(
            db,
            category_id=data.category_id,
            month=budget_sync.next_month(month_start),
            amount=data.amount,
        )
        await db.commit()

    result = await db.execute(
        select(Budget).options(selectinload(Budget.category)).where(Budget.id == budget.id)
    )
    return result.scalar_one()


@router.get("/summary", response_model=BudgetSummary)
async def budget_summary(
    month: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_month = month or await get_app_date(db)
    month_start = first_of_month(target_month)
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1, day=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)

    items = await _budgets_with_spent(target_month, db)
    total_budgeted = sum(b.amount for b in items)
    over_budget = [b for b in items if b.is_over_budget]

    # All categorized and uncategorized expense spending for the month. This
    # deliberately matches the per-category actual-spent calculation above.
    total_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), Decimal("0")))
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.type == TransactionType.expense,
            Transaction.date >= month_start,
            Transaction.date < month_end,
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_(False),
            Transaction.transfer_account_id == None,
            Account.type.not_in([AccountType.mortgage, AccountType.loan]),
        )
    )
    total_spent = float(total_result.scalar() or Decimal("0"))

    # Non-recurring spend with no category OR in an unbudgeted category
    budgeted_category_ids = [b.category_id for b in items]
    if budgeted_category_ids:
        untracked_filter = or_(
            Transaction.category_id.is_(None),
            Transaction.category_id.not_in(budgeted_category_ids),
        )
    else:
        untracked_filter = Transaction.category_id == None
    untracked_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), Decimal("0")))
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.type == TransactionType.expense,
            Transaction.date >= month_start,
            Transaction.date < month_end,
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_(False),
            Transaction.transfer_account_id == None,
            Account.type.not_in([AccountType.mortgage, AccountType.loan]),
            untracked_filter,
        )
    )
    uncategorized_spent = float(untracked_result.scalar() or Decimal("0"))

    return BudgetSummary(
        total_budgeted=float(total_budgeted),
        total_spent=total_spent,
        uncategorized_spent=uncategorized_spent,
        over_budget_categories=over_budget,
    )


@router.get("/monthly-target", response_model=Optional[MonthlyTargetOut])
async def get_monthly_target(
    month: date = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    month_start = first_of_month(month)
    result = await db.execute(
        select(MonthlyBudgetTotal).where(MonthlyBudgetTotal.month == month_start)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    return MonthlyTargetOut(month=row.month, amount=float(row.amount))


@router.put("/monthly-target", response_model=MonthlyTargetOut)
async def set_monthly_target(
    data: MonthlyTargetSet,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    month_start = first_of_month(data.month)
    result = await db.execute(
        select(MonthlyBudgetTotal).where(MonthlyBudgetTotal.month == month_start)
    )
    row = result.scalar_one_or_none()
    if row:
        row.amount = data.amount
    else:
        row = MonthlyBudgetTotal(month=month_start, amount=data.amount)
        db.add(row)
    await db.commit()

    if await budget_sync.is_keep_enabled(db) and await budget_sync.is_current_month(db, month_start):
        await budget_sync.upsert_monthly_total(
            db, month=budget_sync.next_month(month_start), amount=data.amount
        )
        await db.commit()

    return MonthlyTargetOut(month=row.month, amount=float(row.amount))


@router.delete("/monthly-target", status_code=204)
async def delete_monthly_target(
    month: date = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    month_start = first_of_month(month)
    result = await db.execute(
        select(MonthlyBudgetTotal).where(MonthlyBudgetTotal.month == month_start)
    )
    row = result.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()

        if await budget_sync.is_keep_enabled(db) and await budget_sync.is_current_month(db, month_start):
            await budget_sync.delete_monthly_total(
                db, month=budget_sync.next_month(month_start)
            )
            await db.commit()


@router.get("/preferences", response_model=BudgetPrefsOut)
async def get_budget_preferences(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == budget_sync.KEEP_PREF_KEY)
    )
    row = result.scalar_one_or_none()
    return BudgetPrefsOut(keep_for_next_month=row.value == "true" if row else False)


@router.put("/preferences", response_model=BudgetPrefsOut)
async def set_budget_preferences(
    data: BudgetPrefsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == budget_sync.KEEP_PREF_KEY)
    )
    row = result.scalar_one_or_none()
    was_on = (row.value == "true") if row else False
    now_on = data.keep_for_next_month
    val = "true" if now_on else "false"
    if row:
        row.value = val
    else:
        row = AppSetting(key=budget_sync.KEEP_PREF_KEY, value=val)
        db.add(row)
    await db.commit()

    if not was_on and now_on:
        await budget_sync.mirror_current_to_next(db)
        await db.commit()
    elif was_on and not now_on:
        await budget_sync.clear_next_month(db)
        await db.commit()

    return BudgetPrefsOut(keep_for_next_month=now_on)


@router.get("/{budget_id}", response_model=BudgetOut)
async def get_budget(
    budget_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _get_or_404(budget_id, db)


@router.put("/{budget_id}", response_model=BudgetOut)
async def update_budget(
    budget_id: uuid.UUID,
    data: BudgetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = await _get_or_404(budget_id, db)
    category_id = budget.category_id
    month = budget.month
    budget.amount = data.amount
    await db.commit()

    if await budget_sync.is_keep_enabled(db) and await budget_sync.is_current_month(db, month):
        await budget_sync.upsert_category_budget(
            db,
            category_id=category_id,
            month=budget_sync.next_month(month),
            amount=data.amount,
        )
        await db.commit()

    result = await db.execute(
        select(Budget).options(selectinload(Budget.category)).where(Budget.id == budget_id)
    )
    return result.scalar_one()


@router.delete("/{budget_id}", status_code=204)
async def delete_budget(
    budget_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = await _get_or_404(budget_id, db)
    category_id = budget.category_id
    month = budget.month
    await db.delete(budget)
    await db.commit()

    if await budget_sync.is_keep_enabled(db) and await budget_sync.is_current_month(db, month):
        await budget_sync.delete_category_budget(
            db, category_id=category_id, month=budget_sync.next_month(month)
        )
        await db.commit()


@router.post("/copy-month", response_model=list[BudgetOut])
async def copy_month(
    data: CopyMonthRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from_month = first_of_month(data.from_month)
    to_month = first_of_month(data.to_month)

    if not data.overwrite:
        existing_count = await db.scalar(
            select(func.count()).select_from(Budget).where(Budget.month == to_month)
        ) or 0
        existing_target_row = await db.scalar(
            select(MonthlyBudgetTotal).where(MonthlyBudgetTotal.month == to_month)
        )
        has_total = existing_target_row is not None
        if existing_count > 0 or has_total:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "destination_has_budgets",
                    "category_count": int(existing_count),
                    "has_total": has_total,
                    "from_month": from_month.isoformat(),
                    "to_month": to_month.isoformat(),
                },
            )

    source_result = await db.execute(
        select(Budget).where(Budget.month == from_month)
    )
    sources = source_result.scalars().all()
    created = []
    for src in sources:
        existing = await db.execute(
            select(Budget).where(Budget.category_id == src.category_id, Budget.month == to_month)
        )
        b = existing.scalar_one_or_none()
        if b:
            b.amount = src.amount
        else:
            b = Budget(category_id=src.category_id, month=to_month, amount=src.amount)
            db.add(b)
        created.append(b)

    # Copy monthly target if source has one (overwriting any existing destination total).
    source_target = await db.execute(
        select(MonthlyBudgetTotal).where(MonthlyBudgetTotal.month == from_month)
    )
    src_target = source_target.scalar_one_or_none()
    if src_target:
        existing_target_row = await db.scalar(
            select(MonthlyBudgetTotal).where(MonthlyBudgetTotal.month == to_month)
        )
        if existing_target_row:
            existing_target_row.amount = src_target.amount
        else:
            db.add(MonthlyBudgetTotal(month=to_month, amount=src_target.amount))

    await db.commit()

    # Re-fetch with category relationship eagerly loaded (async SQLAlchemy cannot lazy-load)
    ids = [b.id for b in created]
    if ids:
        result = await db.execute(
            select(Budget).options(selectinload(Budget.category)).where(Budget.id.in_(ids))
        )
        return result.scalars().all()
    return []


async def _get_or_404(budget_id: uuid.UUID, db: AsyncSession) -> Budget:
    result = await db.execute(select(Budget).where(Budget.id == budget_id))
    b = result.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=404, detail="Budget not found")
    return b
