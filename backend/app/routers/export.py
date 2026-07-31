import io
import json
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_db, require_admin
from app.models.account import Account, AccountType
from app.models.budget import Budget
from app.models.category import Category, CategoryType
from app.models.expense_account import ExpenseAccount
from app.models.mortgage_detail import MortgageDetail
from app.models.monthly_budget_total import MonthlyBudgetTotal
from app.models.net_worth_snapshot import NetWorthSnapshot
from app.models.recurring_item import RecurringItem, RecurringType, RecurringFrequency
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.models.app_setting import AppSetting
from app.scheduler.setup import reschedule_jobs, scheduler
from app.utils.app_date import get_app_date, parse_timezone

router = APIRouter(tags=["export"])

MAX_IMPORT_BYTES = 10 * 1024 * 1024  # 10 MB — matches nginx client_max_body_size
SUPPORTED_IMPORT_VERSIONS = {"1.0", "1.1"}
PORTABLE_SETTING_KEYS = ("keep_for_next_month", "timezone")
IMPORT_LIST_SECTIONS = (
    "categories",
    "accounts",
    "expense_accounts",
    "recurring_items",
    "budgets",
    "monthly_budget_totals",
    "mortgage_details",
    "net_worth_snapshots",
    "transactions",
)


def _validate_import_payload(data: object) -> dict:
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object at top level")

    version = str(data.get("version", "1.0"))
    if version not in SUPPORTED_IMPORT_VERSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported Denarius export version: {version}",
        )

    for section in IMPORT_LIST_SECTIONS:
        if section in data and not isinstance(data[section], list):
            raise HTTPException(
                status_code=400,
                detail=f"Import section '{section}' must be a list",
            )
        if section in data and any(not isinstance(item, dict) for item in data[section]):
            raise HTTPException(
                status_code=400,
                detail=f"Every item in import section '{section}' must be an object",
            )

    for section in ("settings", "user_preferences"):
        if section in data and not isinstance(data[section], dict):
            raise HTTPException(
                status_code=400,
                detail=f"Import section '{section}' must be an object",
            )
    transaction_scope = data.get("transaction_scope")
    if transaction_scope is not None:
        if not isinstance(transaction_scope, dict):
            raise HTTPException(
                status_code=400,
                detail="Import section 'transaction_scope' must be an object",
            )
        if transaction_scope.get("complete") is not True:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Filtered transaction exports are archives and cannot be restored "
                    "without desynchronizing account balances"
                ),
            )
    return data


def _dashboard_hidden_accounts_for_export(value: str | None) -> list[str] | None:
    if value is None:
        return None
    try:
        decoded = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(decoded, list) or any(not isinstance(item, str) for item in decoded):
        return None
    return decoded


def _dashboard_hidden_accounts_for_import(
    value: object, account_map: dict[str, uuid.UUID]
) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("dashboard_hidden_accounts must contain a JSON list") from exc
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError("dashboard_hidden_accounts must be a list of account IDs")
    return json.dumps([str(account_map.get(item, item)) for item in value])


def _remap_account_breakdown(
    breakdown: object, account_map: dict[str, uuid.UUID]
) -> list:
    if not isinstance(breakdown, list):
        raise ValueError("account_breakdown must be a list")
    remapped = []
    for entry in breakdown:
        if not isinstance(entry, dict):
            raise ValueError("account_breakdown items must be objects")
        copied = dict(entry)
        old_id = copied.get("account_id")
        if isinstance(old_id, str) and old_id in account_map:
            copied["account_id"] = str(account_map[old_id])
        remapped.append(copied)
    return remapped


def _parse_source_uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# EXPORT
# ---------------------------------------------------------------------------

@router.get("/export")
async def export_data(
    include_categories: bool = False,
    include_accounts: bool = False,
    include_expense_accounts: bool = False,
    include_recurring: bool = False,
    include_budgets: bool = False,
    include_settings: bool = False,
    include_mortgage: bool = False,
    include_networth: bool = False,
    include_transactions: bool = False,
    transaction_start_date: Optional[date] = None,
    transaction_end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    export: dict = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": "1.1",
    }

    if include_categories:
        result = await db.execute(
            select(Category).where(Category.deleted_at.is_(None)).order_by(Category.name)
        )
        cats = result.scalars().all()
        export["categories"] = [
            {
                "id": str(c.id),
                "name": c.name,
                "type": c.type.value,
                "color": c.color,
                "icon": c.icon,
                "sort_order": c.sort_order,
                "once_per_month": c.once_per_month,
                "is_system": c.is_system,
            }
            for c in cats
        ]

    if include_accounts:
        result = await db.execute(
            select(Account).where(Account.deleted_at.is_(None)).order_by(Account.sort_order)
        )
        accs = result.scalars().all()
        export["accounts"] = [
            {
                "id": str(a.id),
                "name": a.name,
                "type": a.type.value,
                "institution": a.institution,
                "account_number": a.account_number,
                "current_balance": str(a.current_balance),
                "initial_balance": str(a.initial_balance),
                "credit_limit": str(a.credit_limit) if a.credit_limit is not None else None,
                "sort_order": a.sort_order,
                "notes": a.notes,
                "color": a.color,
                "is_active": a.is_active,
                "linked_mortgage_id": str(a.linked_mortgage_id) if a.linked_mortgage_id else None,
            }
            for a in accs
        ]

    if include_expense_accounts:
        result = await db.execute(
            select(ExpenseAccount)
            .where(ExpenseAccount.deleted_at.is_(None))
            .order_by(ExpenseAccount.sort_order)
        )
        eas = result.scalars().all()
        export["expense_accounts"] = [
            {
                "id": str(ea.id),
                "name": ea.name,
                "color": ea.color,
                "is_active": ea.is_active,
                "sort_order": ea.sort_order,
            }
            for ea in eas
        ]

    if include_recurring:
        result = await db.execute(
            select(RecurringItem).where(RecurringItem.deleted_at.is_(None))
        )
        items = result.scalars().all()
        export["recurring_items"] = [
            {
                "id": str(r.id),
                "name": r.name,
                "account_id": str(r.account_id),
                "category_id": str(r.category_id) if r.category_id else None,
                "expense_account_id": str(r.expense_account_id) if r.expense_account_id else None,
                "amount": str(r.amount),
                "amount_min": str(r.amount_min) if r.amount_min is not None else None,
                "amount_max": str(r.amount_max) if r.amount_max is not None else None,
                "type": r.type.value,
                "frequency": r.frequency.value,
                "day_of_month": r.day_of_month,
                "next_due_date": r.next_due_date.isoformat(),
                "auto_post": r.auto_post,
                "auto_match": r.auto_match,
                "keyword_match": r.keyword_match,
                "is_active": r.is_active,
                "notes": r.notes,
                "last_paid_date": r.last_paid_date.isoformat() if r.last_paid_date else None,
                "last_paid_amount": str(r.last_paid_amount) if r.last_paid_amount is not None else None,
                "last_paid_transaction_id": str(r.last_paid_transaction_id) if r.last_paid_transaction_id else None,
            }
            for r in items
        ]

    if include_budgets:
        result = await db.execute(
            select(Budget).options(selectinload(Budget.category))
        )
        budgets = result.scalars().all()
        export["budgets"] = [
            {
                "id": str(b.id),
                "category_id": str(b.category_id),
                "category_name": b.category.name if b.category else None,
                "month": b.month.isoformat(),
                "amount": str(b.amount),
            }
            for b in budgets
        ]
        result = await db.execute(select(MonthlyBudgetTotal).order_by(MonthlyBudgetTotal.month))
        totals = result.scalars().all()
        export["monthly_budget_totals"] = [
            {"month": total.month.isoformat(), "amount": str(total.amount)}
            for total in totals
        ]

    if include_settings:
        result = await db.execute(
            select(AppSetting).where(AppSetting.key.in_(PORTABLE_SETTING_KEYS))
        )
        export["settings"] = {row.key: row.value for row in result.scalars().all()}
        export["user_preferences"] = {
            "theme_dark": current_user.theme_dark,
            "dashboard_hidden_accounts": _dashboard_hidden_accounts_for_export(
                current_user.dashboard_hidden_accounts
            ),
        }

    if include_mortgage:
        result = await db.execute(
            select(MortgageDetail)
            .join(Account, MortgageDetail.account_id == Account.id)
            .where(Account.deleted_at.is_(None))
        )
        mortgages = result.scalars().all()
        export["mortgage_details"] = [
            {
                "id": str(m.id),
                "account_id": str(m.account_id),
                "original_principal": str(m.original_principal),
                "interest_rate": str(m.interest_rate),
                "term_months": m.term_months,
                "start_date": m.start_date.isoformat(),
                "extra_payment": str(m.extra_payment),
                "loan_type": m.loan_type,
            }
            for m in mortgages
        ]

    if include_networth:
        result = await db.execute(
            select(NetWorthSnapshot).order_by(NetWorthSnapshot.snapshot_date)
        )
        snapshots = result.scalars().all()
        export["net_worth_snapshots"] = [
            {
                "id": str(s.id),
                "snapshot_date": s.snapshot_date.isoformat(),
                "total_assets": str(s.total_assets),
                "total_liabilities": str(s.total_liabilities),
                "net_worth": str(s.net_worth),
                "account_breakdown": s.account_breakdown,
            }
            for s in snapshots
        ]

    if include_transactions:
        scope_complete = True
        if transaction_start_date is not None or transaction_end_date is not None:
            excluded_conditions = []
            if transaction_start_date is not None:
                excluded_conditions.append(Transaction.date < transaction_start_date)
            if transaction_end_date is not None:
                excluded_conditions.append(Transaction.date > transaction_end_date)
            excluded_count = await db.scalar(
                select(func.count(Transaction.id)).where(
                    Transaction.deleted_at.is_(None),
                    or_(*excluded_conditions),
                )
            )
            scope_complete = not excluded_count
        export["transaction_scope"] = {
            "complete": scope_complete,
            "start_date": (
                transaction_start_date.isoformat() if transaction_start_date else None
            ),
            "end_date": transaction_end_date.isoformat() if transaction_end_date else None,
        }
        q = (
            select(Transaction)
            .options(selectinload(Transaction.category), selectinload(Transaction.account))
            .where(Transaction.deleted_at.is_(None))
        )
        if transaction_start_date:
            q = q.where(Transaction.date >= transaction_start_date)
        if transaction_end_date:
            q = q.where(Transaction.date <= transaction_end_date)
        q = q.order_by(Transaction.date.desc())
        result = await db.execute(q)
        txns = result.scalars().all()
        export["transactions"] = [
            {
                "id": str(t.id),
                "account_id": str(t.account_id),
                "account_name": t.account.name if t.account else None,
                "category_id": str(t.category_id) if t.category_id else None,
                "category_name": t.category.name if t.category else None,
                "transfer_account_id": str(t.transfer_account_id) if t.transfer_account_id else None,
                "recurring_item_id": str(t.recurring_item_id) if t.recurring_item_id else None,
                "expense_account_id": str(t.expense_account_id) if t.expense_account_id else None,
                "paired_transaction_id": str(t.paired_transaction_id) if t.paired_transaction_id else None,
                "amount": str(t.amount),
                "type": t.type.value,
                "description": t.description,
                "notes": t.notes,
                "date": t.date.isoformat(),
                "is_hidden": t.is_hidden,
            }
            for t in txns
        ]

    today = (await get_app_date(db)).isoformat()
    content = json.dumps(export, indent=2, default=str)
    return StreamingResponse(
        io.StringIO(content),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=denarius-export-{today}.json"},
    )


# ---------------------------------------------------------------------------
# IMPORT
# ---------------------------------------------------------------------------

@router.post("/import")
async def import_data(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if file.size is not None and file.size > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail=f"Import file exceeds {MAX_IMPORT_BYTES // (1024 * 1024)} MB limit")

    raw = await file.read(MAX_IMPORT_BYTES + 1)
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail=f"Import file exceeds {MAX_IMPORT_BYTES // (1024 * 1024)} MB limit")

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    data = _validate_import_payload(data)

    imported: dict[str, int] = {}
    skipped: dict[str, int] = {}
    errors: list[str] = []

    # ID remap tables: old_str_id -> new UUID
    cat_map: dict[str, uuid.UUID] = {}
    acc_map: dict[str, uuid.UUID] = {}
    ea_map: dict[str, uuid.UUID] = {}
    recurring_map: dict[str, uuid.UUID] = {}
    transaction_map: dict[str, uuid.UUID] = {}
    new_account_ids: set[str] = set()
    new_recurring_ids: set[str] = set()
    new_transaction_ids: set[str] = set()
    restored_timezone: str | None = None

    # ---- Categories ----
    if "categories" in data:
        imp = skp = 0
        for item in data["categories"]:
            savepoint = await db.begin_nested()
            try:
                name = item["name"]
                ctype = CategoryType(item["type"])
                source_category_id = _parse_source_uuid(item.get("id"))
                existing = (
                    await db.get(Category, source_category_id)
                    if source_category_id is not None
                    else None
                )
                # Fresh databases seed system categories with new UUIDs, so
                # those must map deterministically by name/type. Custom category
                # names are not unique and must retain their source identity.
                if existing is None and item.get("is_system", False):
                    result = await db.execute(
                        select(Category)
                        .where(
                            Category.name == name,
                            Category.type == ctype,
                            Category.deleted_at.is_(None),
                            Category.is_system.is_(True),
                        )
                        .limit(1)
                    )
                    existing = result.scalar_one_or_none()
                if existing:
                    cat_map[item["id"]] = existing.id
                    skp += 1
                else:
                    new_cat = Category(
                        id=source_category_id,
                        name=name,
                        type=ctype,
                        color=item.get("color", "#6B7280"),
                        icon=item.get("icon"),
                        sort_order=item.get("sort_order", 0),
                        once_per_month=item.get("once_per_month", False),
                        is_system=item.get("is_system", False),
                    )
                    db.add(new_cat)
                    await db.flush()
                    cat_map[item["id"]] = new_cat.id
                    imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Category '{item.get('name', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["categories"] = imp
        skipped["categories"] = skp

    # ---- Accounts ----
    if "accounts" in data:
        imp = skp = 0
        for item in data["accounts"]:
            savepoint = await db.begin_nested()
            try:
                name = item["name"]
                atype = AccountType(item["type"])
                source_account_id = _parse_source_uuid(item.get("id"))
                existing = (
                    await db.get(Account, source_account_id)
                    if source_account_id is not None
                    else None
                )
                # Stable source IDs are the only safe account identity. Name and
                # type are not unique in Denarius, and merging by those fields
                # can attach a restored ledger to an unrelated opening balance.
                if existing is None and source_account_id is None:
                    result = await db.execute(
                        select(Account)
                        .where(
                            Account.name == name,
                            Account.type == atype,
                            Account.deleted_at.is_(None),
                        )
                        .limit(1)
                    )
                    existing = result.scalar_one_or_none()
                if existing:
                    acc_map[item["id"]] = existing.id
                    skp += 1
                else:
                    new_acc = Account(
                        id=source_account_id,
                        name=name,
                        type=atype,
                        institution=item.get("institution"),
                        account_number=item.get("account_number"),
                        current_balance=Decimal(item.get("current_balance", "0")),
                        initial_balance=Decimal(
                            item.get("initial_balance", item.get("current_balance", "0"))
                        ),
                        credit_limit=Decimal(item["credit_limit"]) if item.get("credit_limit") else None,
                        sort_order=item.get("sort_order", 0),
                        notes=item.get("notes"),
                        color=item.get("color", "#6B7280"),
                        is_active=item.get("is_active", True),
                    )
                    db.add(new_acc)
                    await db.flush()
                    acc_map[item["id"]] = new_acc.id
                    new_account_ids.add(item["id"])
                    imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Account '{item.get('name', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["accounts"] = imp
        skipped["accounts"] = skp

        # Account links can point to an account that appeared later in the file.
        for item in data["accounts"]:
            if item.get("id") not in new_account_ids or not item.get("linked_mortgage_id"):
                continue
            linked_id = acc_map.get(item["linked_mortgage_id"])
            if linked_id is None:
                continue
            account = await db.get(Account, acc_map[item["id"]])
            if account is not None:
                account.linked_mortgage_id = linked_id
        await db.flush()

    # ---- Expense Accounts ----
    if "expense_accounts" in data:
        imp = skp = 0
        for item in data["expense_accounts"]:
            savepoint = await db.begin_nested()
            try:
                name = item["name"]
                source_expense_account_id = _parse_source_uuid(item.get("id"))
                existing = (
                    await db.get(ExpenseAccount, source_expense_account_id)
                    if source_expense_account_id is not None
                    else None
                )
                if existing is None and source_expense_account_id is None:
                    result = await db.execute(
                        select(ExpenseAccount)
                        .where(
                            ExpenseAccount.name == name,
                            ExpenseAccount.deleted_at.is_(None),
                        )
                        .limit(1)
                    )
                    existing = result.scalar_one_or_none()
                if existing:
                    ea_map[item["id"]] = existing.id
                    skp += 1
                else:
                    new_ea = ExpenseAccount(
                        id=source_expense_account_id,
                        name=name,
                        color=item.get("color", "#6B7280"),
                        is_active=item.get("is_active", True),
                        sort_order=item.get("sort_order", 0),
                    )
                    db.add(new_ea)
                    await db.flush()
                    ea_map[item["id"]] = new_ea.id
                    imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Expense account '{item.get('name', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["expense_accounts"] = imp
        skipped["expense_accounts"] = skp

    # ---- Recurring Items ----
    if "recurring_items" in data:
        imp = skp = 0
        for item in data["recurring_items"]:
            savepoint = await db.begin_nested()
            try:
                name = item["name"]
                source_recurring_id = _parse_source_uuid(item.get("id"))
                existing = (
                    await db.get(RecurringItem, source_recurring_id)
                    if source_recurring_id is not None
                    else None
                )
                if existing is None and source_recurring_id is None:
                    result = await db.execute(
                        select(RecurringItem)
                        .where(
                            RecurringItem.name == name,
                            RecurringItem.deleted_at.is_(None),
                        )
                        .limit(1)
                    )
                    existing = result.scalar_one_or_none()
                if existing:
                    recurring_map[item["id"]] = existing.id
                    skp += 1
                    continue

                old_acc_id = item.get("account_id")
                new_acc_id = acc_map.get(old_acc_id) if old_acc_id else None
                if new_acc_id is None and old_acc_id:
                    # Try to use the original ID if it exists in DB
                    try:
                        orig_uuid = uuid.UUID(old_acc_id)
                        res = await db.execute(
                            select(Account).where(Account.id == orig_uuid, Account.deleted_at.is_(None))
                        )
                        if res.scalar_one_or_none():
                            new_acc_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass
                if new_acc_id is None:
                    errors.append(f"Recurring '{name}': account not found, skipping")
                    skp += 1
                    continue

                old_cat_id = item.get("category_id")
                new_cat_id = cat_map.get(old_cat_id) if old_cat_id else None
                if new_cat_id is None and old_cat_id:
                    try:
                        orig_uuid = uuid.UUID(old_cat_id)
                        res = await db.execute(
                            select(Category).where(Category.id == orig_uuid, Category.deleted_at.is_(None))
                        )
                        if res.scalar_one_or_none():
                            new_cat_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass

                old_ea_id = item.get("expense_account_id")
                new_ea_id = ea_map.get(old_ea_id) if old_ea_id else None
                if new_ea_id is None and old_ea_id:
                    try:
                        orig_uuid = uuid.UUID(old_ea_id)
                        res = await db.execute(
                            select(ExpenseAccount).where(
                                ExpenseAccount.id == orig_uuid,
                                ExpenseAccount.deleted_at.is_(None),
                            )
                        )
                        if res.scalar_one_or_none():
                            new_ea_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass

                new_r = RecurringItem(
                    id=source_recurring_id,
                    name=name,
                    account_id=new_acc_id,
                    category_id=new_cat_id,
                    expense_account_id=new_ea_id,
                    created_by=current_user.id,
                    amount=Decimal(item["amount"]),
                    amount_min=Decimal(item["amount_min"]) if item.get("amount_min") else None,
                    amount_max=Decimal(item["amount_max"]) if item.get("amount_max") else None,
                    type=RecurringType(item["type"]),
                    frequency=RecurringFrequency(item["frequency"]),
                    day_of_month=item.get("day_of_month"),
                    next_due_date=date.fromisoformat(item["next_due_date"]),
                    auto_post=item.get("auto_post", False),
                    auto_match=item.get("auto_match", False),
                    keyword_match=item.get("keyword_match"),
                    is_active=item.get("is_active", True),
                    notes=item.get("notes"),
                    last_paid_date=(
                        date.fromisoformat(item["last_paid_date"])
                        if item.get("last_paid_date")
                        else None
                    ),
                    last_paid_amount=(
                        Decimal(item["last_paid_amount"])
                        if item.get("last_paid_amount") is not None
                        else None
                    ),
                )
                db.add(new_r)
                await db.flush()
                recurring_map[item["id"]] = new_r.id
                new_recurring_ids.add(item["id"])
                imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Recurring '{item.get('name', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["recurring_items"] = imp
        skipped["recurring_items"] = skp

    # ---- Budgets ----
    if "budgets" in data:
        imp = skp = 0
        for item in data["budgets"]:
            savepoint = await db.begin_nested()
            try:
                old_cat_id = item.get("category_id")
                new_cat_id = cat_map.get(old_cat_id) if old_cat_id else None
                if new_cat_id is None and old_cat_id:
                    try:
                        orig_uuid = uuid.UUID(old_cat_id)
                        res = await db.execute(
                            select(Category).where(Category.id == orig_uuid, Category.deleted_at.is_(None))
                        )
                        if res.scalar_one_or_none():
                            new_cat_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass
                if new_cat_id is None:
                    errors.append(f"Budget for category '{old_cat_id}' month '{item.get('month')}': category not found, skipping")
                    skp += 1
                    continue

                month = date.fromisoformat(item["month"])
                result = await db.execute(
                    select(Budget).where(
                        Budget.category_id == new_cat_id,
                        Budget.month == month,
                    )
                )
                if result.scalar_one_or_none():
                    skp += 1
                    continue

                new_b = Budget(
                    category_id=new_cat_id,
                    month=month,
                    amount=Decimal(item["amount"]),
                )
                db.add(new_b)
                await db.flush()
                imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Budget '{item.get('category_name', '?')} {item.get('month', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["budgets"] = imp
        skipped["budgets"] = skp

    # ---- Monthly Budget Totals ----
    if "monthly_budget_totals" in data:
        imp = skp = 0
        for item in data["monthly_budget_totals"]:
            savepoint = await db.begin_nested()
            try:
                month = date.fromisoformat(item["month"])
                existing = await db.get(MonthlyBudgetTotal, month)
                if existing:
                    skp += 1
                    continue
                db.add(MonthlyBudgetTotal(month=month, amount=Decimal(item["amount"])))
                await db.flush()
                imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Monthly budget total '{item.get('month', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["monthly_budget_totals"] = imp
        skipped["monthly_budget_totals"] = skp

    # Only known, non-secret application preferences are portable.
    if "settings" in data:
        imp = skp = 0
        settings_data = dict(data["settings"])
        # Accept files produced briefly during 1.1 development, before the
        # actual application key was used by the exporter.
        if (
            "budget_keep_categories" in settings_data
            and "keep_for_next_month" not in settings_data
        ):
            settings_data["keep_for_next_month"] = settings_data[
                "budget_keep_categories"
            ]
        for key in PORTABLE_SETTING_KEYS:
            if key not in settings_data:
                continue
            savepoint = await db.begin_nested()
            try:
                value = str(settings_data[key])
                if key == "timezone":
                    parse_timezone(value)
                elif value not in ("true", "false"):
                    raise ValueError("keep_for_next_month must be 'true' or 'false'")
                row = await db.get(AppSetting, key)
                if row:
                    if row.value == value:
                        skp += 1
                        continue
                    row.value = value
                else:
                    db.add(AppSetting(key=key, value=value))
                await db.flush()
                if key == "timezone":
                    restored_timezone = value
                imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Setting '{key}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["settings"] = imp
        skipped["settings"] = skp

    if isinstance(data.get("user_preferences"), dict):
        preferences = data["user_preferences"]
        savepoint = await db.begin_nested()
        try:
            if "theme_dark" in preferences:
                theme_dark = preferences["theme_dark"]
                if theme_dark is not None and not isinstance(theme_dark, bool):
                    raise ValueError("theme_dark must be a boolean or null")
                current_user.theme_dark = theme_dark
            if "dashboard_hidden_accounts" in preferences:
                current_user.dashboard_hidden_accounts = (
                    _dashboard_hidden_accounts_for_import(
                        preferences["dashboard_hidden_accounts"], acc_map
                    )
                )
            await db.flush()
            imported["user_preferences"] = 1
            skipped["user_preferences"] = 0
        except Exception as e:
            await savepoint.rollback()
            errors.append(f"User preferences: {e}")
            imported["user_preferences"] = 0
            skipped["user_preferences"] = 1
        finally:
            if savepoint.is_active:
                await savepoint.commit()

    # ---- Mortgage Details ----
    if "mortgage_details" in data:
        imp = skp = 0
        for item in data["mortgage_details"]:
            savepoint = await db.begin_nested()
            try:
                old_acc_id = item.get("account_id")
                new_acc_id = acc_map.get(old_acc_id) if old_acc_id else None
                if new_acc_id is None and old_acc_id:
                    try:
                        orig_uuid = uuid.UUID(old_acc_id)
                        res = await db.execute(
                            select(Account).where(Account.id == orig_uuid, Account.deleted_at.is_(None))
                        )
                        if res.scalar_one_or_none():
                            new_acc_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass
                if new_acc_id is None:
                    errors.append(f"Mortgage for account '{old_acc_id}': account not found, skipping")
                    skp += 1
                    continue

                result = await db.execute(
                    select(MortgageDetail).where(MortgageDetail.account_id == new_acc_id)
                )
                existing = result.scalar_one_or_none()
                if existing:
                    skp += 1
                    continue

                new_m = MortgageDetail(
                    account_id=new_acc_id,
                    original_principal=Decimal(item["original_principal"]),
                    interest_rate=Decimal(item["interest_rate"]),
                    term_months=item["term_months"],
                    start_date=date.fromisoformat(item["start_date"]),
                    extra_payment=Decimal(item.get("extra_payment", "0")),
                    loan_type=item.get("loan_type"),
                )
                db.add(new_m)
                await db.flush()
                imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Mortgage account '{item.get('account_id', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["mortgage_details"] = imp
        skipped["mortgage_details"] = skp

    # ---- Net Worth Snapshots ----
    if "net_worth_snapshots" in data:
        imp = skp = 0
        for item in data["net_worth_snapshots"]:
            savepoint = await db.begin_nested()
            try:
                snap_date = date.fromisoformat(item["snapshot_date"])
                result = await db.execute(
                    select(NetWorthSnapshot).where(NetWorthSnapshot.snapshot_date == snap_date)
                )
                if result.scalar_one_or_none():
                    skp += 1
                    continue

                new_s = NetWorthSnapshot(
                    snapshot_date=snap_date,
                    total_assets=Decimal(item["total_assets"]),
                    total_liabilities=Decimal(item["total_liabilities"]),
                    net_worth=Decimal(item["net_worth"]),
                    account_breakdown=_remap_account_breakdown(
                        item.get("account_breakdown", []), acc_map
                    ),
                )
                db.add(new_s)
                await db.flush()
                imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Net worth snapshot '{item.get('snapshot_date', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["net_worth_snapshots"] = imp
        skipped["net_worth_snapshots"] = skp

    # ---- Transactions ----
    if "transactions" in data:
        imp = skp = 0
        # Transaction insertion intentionally does not mutate account balances:
        # a clean restore gets the balance snapshot from the account section.
        # Therefore a new transaction must never be merged into an account that
        # was not created by this same import. Propagate that restriction across
        # pairs so a transfer cannot be restored as a single orphaned leg.
        blocked_transaction_ids = {
            str(item.get("id"))
            for item in data["transactions"]
            if item.get("account_id") not in new_account_ids
        }
        changed = True
        while changed:
            changed = False
            for item in data["transactions"]:
                item_id = str(item.get("id"))
                paired_id = item.get("paired_transaction_id")
                if paired_id in blocked_transaction_ids and item_id not in blocked_transaction_ids:
                    blocked_transaction_ids.add(item_id)
                    changed = True

        for item in data["transactions"]:
            savepoint = await db.begin_nested()
            try:
                source_transaction_id = _parse_source_uuid(item.get("id"))
                if source_transaction_id is not None:
                    existing_by_id = await db.get(Transaction, source_transaction_id)
                    if existing_by_id is not None:
                        transaction_map[item["id"]] = existing_by_id.id
                        skp += 1
                        continue

                transaction_key = str(item.get("id"))
                if transaction_key in blocked_transaction_ids:
                    errors.append(
                        f"Transaction '{item.get('description', '?')} {item.get('date', '?')}': "
                        "not imported because its account already exists; restore into a clean "
                        "target to preserve account and ledger balances"
                    )
                    skp += 1
                    continue

                old_acc_id = item.get("account_id")
                new_acc_id = acc_map.get(old_acc_id) if old_acc_id else None
                if new_acc_id is None and old_acc_id:
                    try:
                        orig_uuid = uuid.UUID(old_acc_id)
                        res = await db.execute(
                            select(Account).where(Account.id == orig_uuid, Account.deleted_at.is_(None))
                        )
                        if res.scalar_one_or_none():
                            new_acc_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass
                if new_acc_id is None:
                    errors.append(f"Transaction '{item.get('description', '?')} {item.get('date', '?')}': account not found, skipping")
                    skp += 1
                    continue

                txn_date = date.fromisoformat(item["date"])
                amount = Decimal(item["amount"])
                description = item.get("description")

                # All Denarius exports contain stable transaction IDs. Preserve
                # those IDs so two legitimate, otherwise-identical transactions
                # survive a round trip and repeated restores are idempotent.
                # Keep the legacy heuristic only for hand-authored records that
                # omit or contain an invalid ID.
                if source_transaction_id is None:
                    result = await db.execute(
                        select(Transaction).where(
                            Transaction.account_id == new_acc_id,
                            Transaction.date == txn_date,
                            Transaction.amount == amount,
                            Transaction.type == TransactionType(item["type"]),
                            Transaction.description == description,
                            Transaction.deleted_at.is_(None),
                        )
                    )
                    existing = result.scalar_one_or_none()
                    if existing:
                        synthetic_key = str(item.get("id", existing.id))
                        transaction_map[synthetic_key] = existing.id
                        skp += 1
                        continue

                old_cat_id = item.get("category_id")
                new_cat_id = cat_map.get(old_cat_id) if old_cat_id else None
                if new_cat_id is None and old_cat_id:
                    try:
                        orig_uuid = uuid.UUID(old_cat_id)
                        res = await db.execute(
                            select(Category).where(Category.id == orig_uuid, Category.deleted_at.is_(None))
                        )
                        if res.scalar_one_or_none():
                            new_cat_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass

                old_transfer_id = item.get("transfer_account_id")
                new_transfer_id = acc_map.get(old_transfer_id) if old_transfer_id else None
                if new_transfer_id is None and old_transfer_id:
                    try:
                        orig_uuid = uuid.UUID(old_transfer_id)
                        res = await db.execute(
                            select(Account).where(Account.id == orig_uuid, Account.deleted_at.is_(None))
                        )
                        if res.scalar_one_or_none():
                            new_transfer_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass

                old_ea_id = item.get("expense_account_id")
                new_ea_id = ea_map.get(old_ea_id) if old_ea_id else None
                if new_ea_id is None and old_ea_id:
                    try:
                        orig_uuid = uuid.UUID(old_ea_id)
                        res = await db.execute(
                            select(ExpenseAccount).where(
                                ExpenseAccount.id == orig_uuid,
                                ExpenseAccount.deleted_at.is_(None),
                            )
                        )
                        if res.scalar_one_or_none():
                            new_ea_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass

                old_recurring_id = item.get("recurring_item_id")
                new_recurring_id = (
                    recurring_map.get(old_recurring_id) if old_recurring_id else None
                )
                if new_recurring_id is None and old_recurring_id:
                    try:
                        orig_uuid = uuid.UUID(old_recurring_id)
                        res = await db.execute(
                            select(RecurringItem).where(
                                RecurringItem.id == orig_uuid,
                                RecurringItem.deleted_at.is_(None),
                            )
                        )
                        if res.scalar_one_or_none():
                            new_recurring_id = orig_uuid
                    except (ValueError, TypeError, AttributeError):
                        pass

                new_t = Transaction(
                    id=source_transaction_id,
                    account_id=new_acc_id,
                    category_id=new_cat_id,
                    transfer_account_id=new_transfer_id,
                    recurring_item_id=new_recurring_id,
                    expense_account_id=new_ea_id,
                    created_by=current_user.id,
                    amount=amount,
                    type=TransactionType(item["type"]),
                    description=description,
                    notes=item.get("notes"),
                    date=txn_date,
                    is_hidden=item.get("is_hidden", False),
                )
                db.add(new_t)
                await db.flush()
                transaction_key = str(item.get("id", new_t.id))
                transaction_map[transaction_key] = new_t.id
                new_transaction_ids.add(transaction_key)
                imp += 1
            except Exception as e:
                await savepoint.rollback()
                errors.append(f"Transaction '{item.get('description', '?')} {item.get('date', '?')}': {e}")
            finally:
                if savepoint.is_active:
                    await savepoint.commit()
        imported["transactions"] = imp
        skipped["transactions"] = skp

        # Self-referential transaction links can only be restored after all
        # transactions have been assigned their new IDs.
        for item in data["transactions"]:
            if item.get("id") not in new_transaction_ids:
                continue
            paired_id = transaction_map.get(item.get("paired_transaction_id"))
            if paired_id is None:
                continue
            transaction = await db.get(Transaction, transaction_map[item["id"]])
            if transaction is not None:
                transaction.paired_transaction_id = paired_id

        for item in data.get("recurring_items", []):
            if item.get("id") not in new_recurring_ids:
                continue
            last_transaction_id = transaction_map.get(item.get("last_paid_transaction_id"))
            if last_transaction_id is None:
                continue
            recurring = await db.get(RecurringItem, recurring_map[item["id"]])
            if recurring is not None:
                recurring.last_paid_transaction_id = last_transaction_id
    await db.commit()
    if restored_timezone is not None and scheduler.running:
        try:
            reschedule_jobs(restored_timezone)
        except Exception as e:
            errors.append(f"Timezone was restored but scheduler rescheduling failed: {e}")

    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
    }
