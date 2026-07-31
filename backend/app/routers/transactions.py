import csv
import io
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone

from app.dependencies import get_current_user, get_db
from app.models.account import Account
from app.models.category import Category, CategoryType
from app.models.expense_account import ExpenseAccount
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.schemas.transaction import BulkDeleteRequest, TransactionCreate, TransactionOut, TransactionUpdate
from app.services.recurring_service import (
    detach_recurring,
    find_and_attach_recurring,
    update_recurring_item,
)
from app.utils.pagination import PagedResponse

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _signed_effect(txn_type: TransactionType, amount: Decimal) -> Decimal:
    if txn_type == TransactionType.expense:
        return -amount
    if txn_type == TransactionType.income:
        return amount
    return Decimal("0")


def _effective_transaction_type(txn: Transaction) -> TransactionType:
    """Transfer legs are persisted as income/expense but presented as transfers."""
    if txn.transfer_account_id is not None and txn.paired_transaction_id is not None:
        return TransactionType.transfer
    return txn.type


def _filter_by_effective_type(query, txn_type: TransactionType):
    is_transfer_leg = (
        Transaction.transfer_account_id.is_not(None)
        & Transaction.paired_transaction_id.is_not(None)
    )
    if txn_type == TransactionType.transfer:
        return query.where(is_transfer_leg)
    return query.where(Transaction.type == txn_type, ~is_transfer_leg)


async def _active_account_or_400(
    account_id: uuid.UUID,
    db: AsyncSession,
    label: str = "Account",
) -> Account:
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
        raise HTTPException(status_code=400, detail=f"{label} not found")
    return account


async def _existing_account_or_400(
    account_id: uuid.UUID,
    db: AsyncSession,
    label: str = "Account",
) -> Account:
    """Load historical accounts when reversing an already-recorded transaction."""
    account = await db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=400, detail=f"{label} not found")
    return account


async def _validate_transaction_references(
    *,
    account_id: uuid.UUID,
    category_id: uuid.UUID | None,
    expense_account_id: uuid.UUID | None,
    transaction_type: TransactionType,
    db: AsyncSession,
) -> Account:
    account = await _active_account_or_400(account_id, db)

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
        expected_category_type = CategoryType(transaction_type.value)
        if category.type != expected_category_type:
            raise HTTPException(
                status_code=400,
                detail=f"Category type must be {expected_category_type.value} for this transaction",
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

    return account


async def _check_once_per_month_transaction(
    category_id: uuid.UUID | None,
    txn_date: date,
    db: AsyncSession,
    exclude_txn_id: uuid.UUID | None = None,
    override: str | None = None,
) -> None:
    """Raise 409 if category is once_per_month and a transaction already exists this month, unless overridden."""
    if not category_id or override:
        return
    cat = await db.get(Category, category_id)
    if not cat or not cat.once_per_month:
        return
    month_start = txn_date.replace(day=1)
    month_end = (
        month_start.replace(year=month_start.year + 1, month=1, day=1)
        if month_start.month == 12
        else month_start.replace(month=month_start.month + 1)
    )
    q = select(Transaction).where(
        Transaction.category_id == category_id,
        Transaction.date >= month_start,
        Transaction.date < month_end,
        Transaction.deleted_at == None,
    )
    if exclude_txn_id:
        q = q.where(Transaction.id != exclude_txn_id)
    existing = (await db.execute(q)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Category '{cat.name}' is marked once-per-month and already has a transaction this month.",
            headers={"X-Conflict": "once_per_month"},
        )


@router.get("", response_model=PagedResponse[TransactionOut])
async def list_transactions(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    account_id: Optional[uuid.UUID] = None,
    category_id: Optional[uuid.UUID] = None,
    type: Optional[TransactionType] = None,
    search: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    expense_account_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Transaction).options(selectinload(Transaction.category), selectinload(Transaction.recurring_item), selectinload(Transaction.account), selectinload(Transaction.expense_account)).where(Transaction.deleted_at == None, Transaction.is_hidden != True)
    if account_id:
        q = q.where(Transaction.account_id == account_id)
    if category_id:
        q = q.where(Transaction.category_id == category_id)
    if type:
        q = _filter_by_effective_type(q, type)
    if search:
        q = q.where(Transaction.description.ilike(f"%{search}%"))
    if start_date:
        q = q.where(Transaction.date >= start_date)
    if end_date:
        q = q.where(Transaction.date <= end_date)
    if expense_account_id:
        q = q.where(Transaction.expense_account_id == expense_account_id)

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar()
    offset = (page - 1) * limit
    result = await db.execute(q.order_by(Transaction.date.desc()).offset(offset).limit(limit))
    items = result.scalars().all()
    return PagedResponse(items=items, total=total, page=page, pages=-(-total // limit), limit=limit)


@router.post("", response_model=TransactionOut, status_code=201)
async def create_transaction(
    data: TransactionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    override = data.once_per_month_override
    account = await _validate_transaction_references(
        account_id=data.account_id,
        category_id=data.category_id,
        expense_account_id=data.expense_account_id,
        transaction_type=data.type,
        db=db,
    )
    destination_account = None
    if data.type == TransactionType.transfer:
        if data.transfer_account_id is None:
            raise HTTPException(status_code=400, detail="Destination account is required for transfers")
        if data.transfer_account_id == data.account_id:
            raise HTTPException(status_code=400, detail="Source and destination accounts must be different")
        destination_account = await _active_account_or_400(
            data.transfer_account_id,
            db,
            "Destination account",
        )
    elif data.transfer_account_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Destination account is only valid for transfers",
        )
    await _check_once_per_month_transaction(data.category_id, data.date, db, override=override)

    txn = Transaction(**data.model_dump(exclude={"once_per_month_override"}), created_by=current_user.id)
    db.add(txn)

    # Update account balance
    if data.type == TransactionType.expense:
        account.current_balance -= data.amount
    elif data.type == TransactionType.income:
        account.current_balance += data.amount
    elif data.type == TransactionType.transfer and destination_account is not None:
        txn.type = TransactionType.expense
        account.current_balance -= data.amount
        destination_account.current_balance += data.amount
        dest_txn = Transaction(
            account_id=data.transfer_account_id,
            transfer_account_id=data.account_id,
            amount=data.amount,
            type=TransactionType.income,
            description=data.description,
            notes=data.notes,
            date=data.date,
            created_by=current_user.id,
        )
        db.add(dest_txn)
        await db.flush()
        txn.paired_transaction_id = dest_txn.id
        dest_txn.paired_transaction_id = txn.id

    # Auto-match to a recurring item if one is configured for this transaction.
    # extra_payment skips matching (standalone payment, don't advance next_due_date).
    # next_month_payment runs matching so the recurring item advances an extra cycle.
    if override != "extra_payment" and not data.model_dump(exclude={"once_per_month_override"}).get("recurring_item_id"):
        await find_and_attach_recurring(txn, db)

    await db.commit()
    return await _get_or_404(txn.id, db)


@router.get("/export")
async def export_transactions(
    account_id: Optional[uuid.UUID] = None,
    category_id: Optional[uuid.UUID] = None,
    expense_account_id: Optional[uuid.UUID] = None,
    type: Optional[TransactionType] = None,
    search: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Transaction).options(selectinload(Transaction.category)).where(Transaction.deleted_at == None, Transaction.is_hidden != True)
    if account_id:
        q = q.where(Transaction.account_id == account_id)
    if category_id:
        q = q.where(Transaction.category_id == category_id)
    if expense_account_id:
        q = q.where(Transaction.expense_account_id == expense_account_id)
    if type:
        q = _filter_by_effective_type(q, type)
    if search:
        q = q.where(Transaction.description.ilike(f"%{search}%"))
    if start_date:
        q = q.where(Transaction.date >= start_date)
    if end_date:
        q = q.where(Transaction.date <= end_date)
    result = await db.execute(q.order_by(Transaction.date.desc()))
    transactions = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Type", "Description", "Amount", "Category"])
    for t in transactions:
        writer.writerow([
            t.date.isoformat(),
            _effective_transaction_type(t).value,
            t.description or "",
            str(t.amount),
            t.category.name if t.category else "",
        ])
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transactions.csv"},
    )


@router.get("/{transaction_id}", response_model=TransactionOut)
async def get_transaction(
    transaction_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _get_or_404(transaction_id, db)


@router.put("/{transaction_id}", response_model=TransactionOut)
async def update_transaction(
    transaction_id: uuid.UUID,
    data: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txn = await _get_or_404(transaction_id, db)
    had_recurring = txn.recurring_item_id is not None
    override = data.once_per_month_override

    # Snapshot state needed for balance adjustment and transfer counterpart lookup
    old_amount = txn.amount
    old_date = txn.date
    old_type = txn.type
    old_account_id = txn.account_id

    update_fields = data.model_fields_set
    is_transfer_pair = (
        txn.paired_transaction_id is not None
        and txn.transfer_account_id is not None
    )
    if txn.paired_transaction_id is not None:
        if "type" in update_fields and data.type != old_type:
            raise HTTPException(
                status_code=400,
                detail="Paired transaction type cannot be changed; delete and recreate it instead.",
            )
        if "account_id" in update_fields and data.account_id != old_account_id:
            raise HTTPException(
                status_code=400,
                detail="Paired transactions cannot be moved between accounts; delete and recreate them instead.",
            )
        if not is_transfer_pair and "amount" in update_fields and data.amount != old_amount:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Mortgage payment amounts cannot be edited independently; "
                    "delete and record the payment again."
                ),
            )
    if had_recurring:
        if "account_id" in update_fields and data.account_id != old_account_id:
            raise HTTPException(
                status_code=400,
                detail="Recurring-linked transactions cannot be moved to another account.",
            )
        if "type" in update_fields and data.type != old_type:
            raise HTTPException(
                status_code=400,
                detail="Recurring-linked transaction type cannot be changed.",
            )
    new_account_id = data.account_id if "account_id" in update_fields else txn.account_id
    new_category_id = data.category_id if "category_id" in update_fields else txn.category_id
    new_expense_account_id = (
        data.expense_account_id
        if "expense_account_id" in update_fields
        else txn.expense_account_id
    )
    new_type = data.type if "type" in update_fields else txn.type
    # Transfer pairs are stored as income/expense legs; their category must still
    # be a transfer category when either leg is edited.
    reference_type = TransactionType.transfer if is_transfer_pair else new_type
    await _validate_transaction_references(
        account_id=new_account_id,
        category_id=new_category_id,
        expense_account_id=new_expense_account_id,
        transaction_type=reference_type,
        db=db,
    )
    if txn.paired_transaction_id is not None and txn.transfer_account_id is not None:
        await _active_account_or_400(
            txn.transfer_account_id,
            db,
            "Transfer account",
        )

    for field, value in data.model_dump(exclude_unset=True, exclude={"once_per_month_override"}).items():
        setattr(txn, field, value)

    if old_type != txn.type and (
        old_type == TransactionType.transfer or txn.type == TransactionType.transfer
    ):
        raise HTTPException(
            status_code=400,
            detail="Cannot change transaction type to/from transfer; delete and recreate instead.",
        )

    if old_account_id != txn.account_id and txn.paired_transaction_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot move a transfer transaction between accounts; delete and recreate instead.",
        )

    await _check_once_per_month_transaction(txn.category_id, txn.date, db, exclude_txn_id=txn.id, override=override)

    amount_delta = txn.amount - old_amount

    if txn.paired_transaction_id:
        # Transfer — find counterpart via direct link
        dest_txn = await db.get(Transaction, txn.paired_transaction_id)
        if dest_txn and dest_txn.deleted_at is None:
            if amount_delta != 0:
                dest_txn.amount = txn.amount
                # Adjust both accounts using normal income/expense logic
                this_account = await db.get(Account, txn.account_id)
                if this_account:
                    if txn.type == TransactionType.expense:
                        this_account.current_balance -= amount_delta
                    else:
                        this_account.current_balance += amount_delta
                other_account = await db.get(Account, dest_txn.account_id)
                if other_account:
                    if dest_txn.type == TransactionType.expense:
                        other_account.current_balance -= amount_delta
                    else:
                        other_account.current_balance += amount_delta
            # Sync metadata to counterpart
            dest_txn.date = txn.date
            dest_txn.description = txn.description
            dest_txn.notes = txn.notes
            dest_txn.category_id = txn.category_id

    else:
        old_effect = _signed_effect(old_type, old_amount)
        new_effect = _signed_effect(txn.type, txn.amount)
        old_account = await db.get(Account, old_account_id)
        if old_account:
            old_account.current_balance -= old_effect
        if old_account_id == txn.account_id:
            new_account = old_account
        else:
            new_account = await db.get(Account, txn.account_id)
        if new_account:
            new_account.current_balance += new_effect

    # If the transaction had no recurring link and the edit might now make it match, re-check
    if not had_recurring and txn.recurring_item_id is None and override != "extra_payment":
        await find_and_attach_recurring(txn, db)
    elif had_recurring:
        await update_recurring_item(txn, db, previous_date=old_date)

    await db.commit()
    return await _get_or_404(txn.id, db)


@router.delete("/{transaction_id}", status_code=204)
async def delete_transaction(
    transaction_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    txn = await _get_or_404(transaction_id, db)
    await _reverse_balance_and_delete(txn, db, now)
    await db.commit()


@router.post("/bulk-delete", status_code=204)
async def bulk_delete(
    data: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Transaction).where(Transaction.id.in_(data.ids), Transaction.deleted_at == None)
    )
    for txn in result.scalars().all():
        if txn.deleted_at is not None:
            # Already soft-deleted as the counterpart of a transfer processed earlier
            continue
        await _reverse_balance_and_delete(txn, db, now)
    await db.commit()


async def _reverse_balance_and_delete(txn: Transaction, db: AsyncSession, now: datetime) -> None:
    """Reverse the account balance effect of a transaction and soft-delete it."""
    await detach_recurring(txn, db)

    # Cascade delete paired transaction (transfer counterpart or linked mortgage leg)
    if txn.paired_transaction_id:
        paired = await db.get(Transaction, txn.paired_transaction_id)
        if paired and paired.deleted_at is None:
            await detach_recurring(paired, db)
            paired_account = await _existing_account_or_400(
                paired.account_id,
                db,
                "Paired transaction account",
            )
            if paired.type == TransactionType.expense:
                paired_account.current_balance += paired.amount
            elif paired.type == TransactionType.income:
                paired_account.current_balance -= paired.amount
            paired.paired_transaction_id = None
            paired.deleted_at = now

    txn.deleted_at = now

    account = await _existing_account_or_400(txn.account_id, db)

    if txn.type == TransactionType.expense:
        account.current_balance += txn.amount
    elif txn.type == TransactionType.income:
        account.current_balance -= txn.amount


async def _get_or_404(transaction_id: uuid.UUID, db: AsyncSession) -> Transaction:
    result = await db.execute(
        select(Transaction)
        .options(selectinload(Transaction.category), selectinload(Transaction.recurring_item), selectinload(Transaction.account), selectinload(Transaction.expense_account))
        .where(Transaction.id == transaction_id, Transaction.deleted_at == None)
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn
