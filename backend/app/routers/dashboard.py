from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db
from app.models.account import Account, AccountType
from app.models.monthly_budget_total import MonthlyBudgetTotal
from app.models.recurring_item import RecurringItem
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.routers.budgets import _budgets_with_spent
from app.routers.system import get_app_date
from app.schemas.dashboard import DashboardSummary, MonthlySpendingSummary
from app.schemas.transaction import TransactionOut
from app.services.networth_service import get_current_net_worth
from app.utils.date_utils import first_of_month

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
async def dashboard_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = await get_app_date(db)
    current_month_start = first_of_month(today)
    if current_month_start.month == 1:
        prev_month_start = current_month_start.replace(year=current_month_start.year - 1, month=12)
    else:
        prev_month_start = current_month_start.replace(month=current_month_start.month - 1)

    if current_month_start.month == 12:
        next_month_start = current_month_start.replace(year=current_month_start.year + 1, month=1)
    else:
        next_month_start = current_month_start.replace(month=current_month_start.month + 1)

    # Net worth
    net_worth = await get_current_net_worth(db)

    # Monthly spending
    _liability_types = [AccountType.mortgage, AccountType.loan]

    curr_spending_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), Decimal("0")))
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.type == TransactionType.expense,
            Transaction.date >= current_month_start,
            Transaction.date < next_month_start,
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_(False),
            Transaction.transfer_account_id == None,
            Account.type.not_in(_liability_types),
        )
    )
    current_spending = curr_spending_result.scalar() or Decimal("0")

    non_bill_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), Decimal("0")))
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.type == TransactionType.expense,
            Transaction.date >= current_month_start,
            Transaction.date < next_month_start,
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_(False),
            Transaction.transfer_account_id == None,
            Transaction.recurring_item_id == None,
            Account.type.not_in(_liability_types),
        )
    )
    non_bill_spending = non_bill_result.scalar() or Decimal("0")

    curr_income_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), Decimal("0")))
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.type == TransactionType.income,
            Transaction.date >= current_month_start,
            Transaction.date < next_month_start,
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_(False),
            Transaction.transfer_account_id == None,
            Account.type.not_in(_liability_types),
        )
    )
    current_income = curr_income_result.scalar() or Decimal("0")

    prev_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), Decimal("0")))
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.type == TransactionType.expense,
            Transaction.date >= prev_month_start,
            Transaction.date < current_month_start,
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_(False),
            Transaction.transfer_account_id == None,
            Account.type.not_in(_liability_types),
        )
    )
    prev_spending = prev_result.scalar() or Decimal("0")

    # Budget total for current month — prefer MonthlyBudgetTotal, fall back to category sum
    budget_items = await _budgets_with_spent(today, db)
    monthly_target_result = await db.execute(
        select(MonthlyBudgetTotal).where(MonthlyBudgetTotal.month == current_month_start)
    )
    monthly_target = monthly_target_result.scalar_one_or_none()
    if monthly_target is not None:
        budget_total = monthly_target.amount
    else:
        budget_total = sum(b.amount for b in budget_items)
    over_budget = [b for b in budget_items if b.is_over_budget]

    # Upcoming bills (next 7 days)
    cutoff = today + timedelta(days=7)
    upcoming_result = await db.execute(
        select(RecurringItem)
        .where(
            RecurringItem.is_active == True,
            RecurringItem.deleted_at == None,
            RecurringItem.next_due_date <= cutoff,
        )
        .order_by(RecurringItem.next_due_date)
        .limit(10)
    )
    from app.routers.recurring import (
        _month_bounds,
        _paid_counts_for_month,
        _with_days_until_due,
    )
    month_start, month_end = _month_bounds(today)
    paid_counts = await _paid_counts_for_month(month_start, today, db)
    upcoming_bills = [
        _with_days_until_due(item, today, month_start, month_end, paid_counts)
        for item in upcoming_result.scalars().all()
    ]

    # Recent transactions
    recent_result = await db.execute(
        select(Transaction)
        .options(selectinload(Transaction.category), selectinload(Transaction.account))
        .where(Transaction.deleted_at == None, Transaction.is_hidden.is_(False))
        .order_by(Transaction.date.desc(), Transaction.created_at.desc())
        .limit(10)
    )
    recent_transactions = recent_result.scalars().all()

    return DashboardSummary(
        net_worth=net_worth,
        monthly_spending=MonthlySpendingSummary(
            current_month=current_spending,
            current_month_income=current_income,
            prev_month=prev_spending,
            budget_total=budget_total,
            non_bill_spending=non_bill_spending,
        ),
        upcoming_bills=upcoming_bills,
        recent_transactions=recent_transactions,
        over_budget_alerts=over_budget,
    )
