import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.account import Account, AccountType
from app.models.category import Category, CategoryType
from app.models.expense_account import ExpenseAccount
from app.models.recurring_item import RecurringFrequency, RecurringItem, RecurringType
from app.models.transaction import Transaction
from app.models.user import User
from app.routers.system import get_app_date
from app.schemas.recurring_item import MarkPaidNoTransactionRequest, MarkPaidRequest, RecurringCreate, RecurringOut, RecurringUpdate, RecurringSummaryOut
from app.services.recurring_service import mark_paid, mark_paid_no_transaction, match_unlinked_current_month
from app.utils.date_utils import rewind_by_frequency

router = APIRouter(prefix="/recurring", tags=["recurring"])


async def _validate_recurring_references(
    *,
    account_id: uuid.UUID,
    category_id: uuid.UUID | None,
    expense_account_id: uuid.UUID | None,
    recurring_type: RecurringType,
    db: AsyncSession,
    source_account_id: uuid.UUID | None = None,
) -> None:
    account = (
        await db.execute(
            select(Account).where(
                Account.id == account_id,
                Account.deleted_at == None,
                Account.is_active == True,
            )
        )
    ).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=400, detail="Account not found")

    if source_account_id is not None:
        if account.type != AccountType.mortgage:
            raise HTTPException(
                status_code=400,
                detail="Source account is only valid for mortgage recurring payments",
            )
        if source_account_id == account_id:
            raise HTTPException(
                status_code=422,
                detail="Mortgage payments must use a different source account",
            )
        source_account = (
            await db.execute(
                select(Account).where(
                    Account.id == source_account_id,
                    Account.deleted_at == None,
                    Account.is_active == True,
                )
            )
        ).scalar_one_or_none()
        if source_account is None:
            raise HTTPException(status_code=400, detail="Source account not found")

    if category_id is not None:
        category = (
            await db.execute(
                select(Category).where(
                    Category.id == category_id,
                    Category.deleted_at == None,
                )
            )
        ).scalar_one_or_none()
        if category is None:
            raise HTTPException(status_code=400, detail="Category not found")
        expected_type = (
            CategoryType.income
            if recurring_type == RecurringType.income
            else CategoryType.expense
        )
        if category.type != expected_type:
            raise HTTPException(
                status_code=400,
                detail=f"Category type must be {expected_type.value} for this recurring item",
            )

    if expense_account_id is not None:
        expense_account = (
            await db.execute(
                select(ExpenseAccount).where(
                    ExpenseAccount.id == expense_account_id,
                    ExpenseAccount.deleted_at == None,
                )
            )
        ).scalar_one_or_none()
        if expense_account is None:
            raise HTTPException(status_code=400, detail="Expense account not found")


def _month_bounds(today: date) -> tuple[date, date]:
    month_start = today.replace(day=1)
    month_end = (month_start.replace(month=month_start.month + 1) if month_start.month < 12
                 else month_start.replace(year=today.year + 1, month=1)) - timedelta(days=1)
    return month_start, month_end


def _with_days_until_due(
    item: RecurringItem,
    today: date,
    month_start: date,
    month_end: date,
    paid_counts: dict[uuid.UUID, int],
) -> RecurringOut:
    days = (item.next_due_date - today).days
    out = RecurringOut.model_validate(item)
    out.days_until_due = days

    expected = _count_occurrences_in_month(item, month_start, month_end)
    paid = paid_counts.get(item.id, 0)
    # Fallback for mark_paid_no_transaction (creates no Transaction row).
    if paid == 0 and item.last_paid_date and month_start <= item.last_paid_date <= today:
        paid = 1
    expected = max(expected, paid)

    out.expected_payments_this_month = expected
    out.paid_payments_this_month = paid
    out.is_paid_current_period = expected > 0 and paid >= expected
    return out


async def _paid_count_for(item_id: uuid.UUID, month_start: date, today: date, db: AsyncSession) -> dict[uuid.UUID, int]:
    result = await db.execute(
        select(func.count(Transaction.id)).where(
            Transaction.recurring_item_id == item_id,
            Transaction.deleted_at.is_(None),
            Transaction.date >= month_start,
            Transaction.date <= today,
        )
    )
    return {item_id: int(result.scalar_one() or 0)}


async def _paid_counts_for_month(month_start: date, today: date, db: AsyncSession) -> dict[uuid.UUID, int]:
    rows = await db.execute(
        select(Transaction.recurring_item_id, func.count(Transaction.id))
        .where(
            Transaction.recurring_item_id.is_not(None),
            Transaction.deleted_at.is_(None),
            Transaction.date >= month_start,
            Transaction.date <= today,
        )
        .group_by(Transaction.recurring_item_id)
    )
    return {rid: int(c) for rid, c in rows.all()}


@router.get("", response_model=list[RecurringOut])
async def list_recurring(
    type: Optional[RecurringType] = None,
    is_active: Optional[bool] = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = await get_app_date(db)
    month_start, month_end = _month_bounds(today)
    q = select(RecurringItem).where(RecurringItem.deleted_at == None)
    if type:
        q = q.where(RecurringItem.type == type)
    if is_active is not None:
        q = q.where(RecurringItem.is_active == is_active)
    result = await db.execute(q.order_by(RecurringItem.next_due_date))
    paid_counts = await _paid_counts_for_month(month_start, today, db)
    return [_with_days_until_due(item, today, month_start, month_end, paid_counts) for item in result.scalars().all()]


@router.get("/upcoming", response_model=list[RecurringOut])
async def upcoming_recurring(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = await get_app_date(db)
    month_start, month_end = _month_bounds(today)
    cutoff = today + timedelta(days=days)
    result = await db.execute(
        select(RecurringItem)
        .where(
            RecurringItem.is_active == True,
            RecurringItem.deleted_at == None,
            RecurringItem.next_due_date <= cutoff,
        )
        .order_by(RecurringItem.next_due_date)
    )
    paid_counts = await _paid_counts_for_month(month_start, today, db)
    return [_with_days_until_due(item, today, month_start, month_end, paid_counts) for item in result.scalars().all()]


def _count_occurrences_in_month(item: RecurringItem, month_start: date, month_end: date) -> int:
    """Count how many times this item occurs in the given month."""
    freq = item.frequency
    if freq == RecurringFrequency.monthly:
        return 1
    if freq in (
        RecurringFrequency.quarterly,
        RecurringFrequency.semiannually,
        RecurringFrequency.annually,
    ):
        # Check if next_due_date is in this month
        if item.next_due_date and month_start <= item.next_due_date <= month_end:
            return 1
        # If already paid, next_due_date advanced past this month — check previous period
        prev = rewind_by_frequency(item.next_due_date, freq)
        if month_start <= prev <= month_end:
            return 1
        return 0
    # weekly / biweekly — walk backwards from past month_end to count all dates in the month
    interval = timedelta(days=7 if freq == RecurringFrequency.weekly else 14)
    d = item.next_due_date
    while d <= month_end:
        d += interval
    count = 0
    d -= interval
    while d >= month_start:
        count += 1
        d -= interval
    return count


@router.get("/summary", response_model=RecurringSummaryOut)
async def get_recurring_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get summary of paid and expected amounts for recurring items in the current month.
    Uses actual transaction amounts for paid items, configured amounts for unpaid items.
    """
    today = await get_app_date(db)
    month_start = today.replace(day=1)
    month_end = (month_start.replace(month=month_start.month + 1) if month_start.month < 12
                 else month_start.replace(year=today.year + 1, month=1)) - timedelta(days=1)

    # Get all transactions linked to recurring items in the current month
    result = await db.execute(
        select(Transaction).where(
            Transaction.recurring_item_id != None,
            Transaction.deleted_at == None,
            Transaction.date >= month_start,
            Transaction.date <= today,
        )
    )
    transactions = result.scalars().all()

    # Group transactions by recurring item
    item_txns: dict[uuid.UUID, list[Transaction]] = {}
    for txn in transactions:
        item_txns.setdefault(txn.recurring_item_id, []).append(txn)

    # Get active recurring items
    recurring_items_result = await db.execute(
        select(RecurringItem).where(
            RecurringItem.deleted_at == None,
            RecurringItem.is_active == True,
        )
    )

    # Accumulate per-type totals
    totals: dict[str, dict[str, Decimal | int]] = {
        t: {"paid": Decimal("0"), "paid_count": 0, "expected": Decimal("0"), "total": 0}
        for t in ("subscription", "bill", "income")
    }

    for item in recurring_items_result.scalars().all():
        t = totals.get(item.type.value)
        if not t:
            continue

        txns = item_txns.pop(item.id, [])
        paid_amount = sum(abs(txn.amount) for txn in txns)
        paid_count = len(txns)

        # Fallback: mark_paid_no_transaction (no Transaction created)
        if paid_count == 0 and item.last_paid_date and month_start <= item.last_paid_date <= today:
            paid_amount = abs(item.last_paid_amount or item.amount)
            paid_count = 1

        total_occ = _count_occurrences_in_month(item, month_start, month_end)
        # Paid items may have advanced next_due_date out of this month — ensure we count them
        total_occ = max(total_occ, paid_count)

        remaining = total_occ - paid_count
        expected = paid_amount + abs(item.amount) * remaining

        t["paid"] += paid_amount
        t["paid_count"] += paid_count
        t["expected"] += expected
        t["total"] += total_occ

    return RecurringSummaryOut(
        subscriptions_paid=float(totals["subscription"]["paid"]),
        subscriptions_count=int(totals["subscription"]["paid_count"]),
        subscriptions_expected=float(totals["subscription"]["expected"]),
        subscriptions_total=int(totals["subscription"]["total"]),
        bills_paid=float(totals["bill"]["paid"]),
        bills_count=int(totals["bill"]["paid_count"]),
        bills_expected=float(totals["bill"]["expected"]),
        bills_total=int(totals["bill"]["total"]),
        income_paid=float(totals["income"]["paid"]),
        income_count=int(totals["income"]["paid_count"]),
        income_expected=float(totals["income"]["expected"]),
        income_total=int(totals["income"]["total"]),
    )


async def _check_once_per_month_category(
    category_id: uuid.UUID | None,
    db: AsyncSession,
    exclude_item_id: uuid.UUID | None = None,
) -> None:
    """Raise 409 if category is once_per_month and already assigned to another active recurring item."""
    if not category_id:
        return
    cat = await db.get(Category, category_id)
    if not cat or not cat.once_per_month:
        return
    q = select(RecurringItem).where(
        RecurringItem.category_id == category_id,
        RecurringItem.deleted_at == None,
        RecurringItem.is_active == True,
    )
    if exclude_item_id:
        q = q.where(RecurringItem.id != exclude_item_id)
    existing = (await db.execute(q)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Category '{cat.name}' is marked once-per-month and is already assigned to another active recurring bill.",
        )


async def _build_single_out(item: RecurringItem, db: AsyncSession) -> RecurringOut:
    today = await get_app_date(db)
    month_start, month_end = _month_bounds(today)
    paid_counts = await _paid_count_for(item.id, month_start, today, db)
    return _with_days_until_due(item, today, month_start, month_end, paid_counts)


@router.post("", response_model=RecurringOut, status_code=201)
async def create_recurring(
    data: RecurringCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _validate_recurring_references(
        account_id=data.account_id,
        category_id=data.category_id,
        expense_account_id=data.expense_account_id,
        recurring_type=data.type,
        db=db,
    )
    await _check_once_per_month_category(data.category_id, db)
    item = RecurringItem(**data.model_dump(), created_by=current_user.id)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return await _build_single_out(item, db)


@router.get("/{item_id}", response_model=RecurringOut)
async def get_recurring(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = await _get_or_404(item_id, db)
    return await _build_single_out(item, db)


@router.put("/{item_id}", response_model=RecurringOut)
async def update_recurring(
    item_id: uuid.UUID,
    data: RecurringUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = await _get_or_404(item_id, db)
    update_fields = data.model_fields_set
    new_account_id = data.account_id if "account_id" in update_fields else item.account_id
    new_category_id = data.category_id if "category_id" in update_fields else item.category_id
    new_expense_account_id = (
        data.expense_account_id
        if "expense_account_id" in update_fields
        else item.expense_account_id
    )
    new_type = data.type if "type" in update_fields else item.type
    await _validate_recurring_references(
        account_id=new_account_id,
        category_id=new_category_id,
        expense_account_id=new_expense_account_id,
        recurring_type=new_type,
        db=db,
    )
    new_amount_min = data.amount_min if "amount_min" in update_fields else item.amount_min
    new_amount_max = data.amount_max if "amount_max" in update_fields else item.amount_max
    if (
        new_amount_min is not None
        and new_amount_max is not None
        and new_amount_min > new_amount_max
    ):
        raise HTTPException(status_code=400, detail="amount_min cannot be greater than amount_max")
    await _check_once_per_month_category(new_category_id, db, exclude_item_id=item_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await match_unlinked_current_month(item, db)
    await db.commit()
    await db.refresh(item)
    return await _build_single_out(item, db)


@router.delete("/{item_id}", status_code=204)
async def delete_recurring(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = await _get_or_404(item_id, db)
    item.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{item_id}/mark-paid", response_model=RecurringOut, status_code=201)
async def mark_paid_endpoint(
    item_id: uuid.UUID,
    data: MarkPaidRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = await _get_or_404(item_id, db)
    category_id_provided = "category_id" in data.model_fields_set
    resolved_category_id = (
        data.category_id if category_id_provided else item.category_id
    )
    await _validate_recurring_references(
        account_id=data.account_id or item.account_id,
        category_id=resolved_category_id,
        expense_account_id=item.expense_account_id,
        recurring_type=item.type,
        source_account_id=data.source_account_id,
        db=db,
    )
    await mark_paid(
        item,
        db,
        current_user.id,
        data.date,
        data.amount,
        data.description,
        data.account_id,
        data.category_id,
        data.source_account_id,
        category_id_provided=category_id_provided,
    )
    await db.refresh(item)
    return await _build_single_out(item, db)


@router.post("/{item_id}/mark-paid-no-transaction", response_model=RecurringOut, status_code=200)
async def mark_paid_no_transaction_endpoint(
    item_id: uuid.UUID,
    data: MarkPaidNoTransactionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = await _get_or_404(item_id, db)
    await _validate_recurring_references(
        account_id=item.account_id,
        category_id=item.category_id,
        expense_account_id=item.expense_account_id,
        recurring_type=item.type,
        db=db,
    )
    await mark_paid_no_transaction(item, db, data.date, data.amount)
    await db.refresh(item)
    return await _build_single_out(item, db)


async def _get_or_404(item_id: uuid.UUID, db: AsyncSession) -> RecurringItem:
    result = await db.execute(
        select(RecurringItem).where(RecurringItem.id == item_id, RecurringItem.deleted_at == None)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Recurring item not found")
    return item
