from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.account import Account, AccountType
from app.models.category import Category
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.schemas.report import CashFlowReport, MonthlyIncomeExpense, MonthlyTrend, SpendingByCategory

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/spending-by-category", response_model=list[SpendingByCategory])
async def spending_by_category(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _liability_types = [AccountType.mortgage, AccountType.loan]
    q = (
        select(
            Category.id,
            Category.name,
            Category.color,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.type == TransactionType.expense,
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_not(True),
            Transaction.transfer_account_id == None,
            Account.type.not_in(_liability_types),
        )
        .group_by(Category.id, Category.name, Category.color)
        .order_by(func.sum(Transaction.amount).desc())
    )
    if start_date:
        q = q.where(Transaction.date >= start_date)
    if end_date:
        q = q.where(Transaction.date <= end_date)

    result = await db.execute(q)
    rows = result.all()
    grand_total = sum(r.total for r in rows) or Decimal("1")

    return [
        SpendingByCategory(
            category_id=str(r.id),
            category_name=r.name,
            color=r.color,
            total=r.total,
            percentage=round(float(r.total / grand_total * 100), 2),
        )
        for r in rows
    ]


@router.get("/income-vs-expense", response_model=list[MonthlyIncomeExpense])
async def income_vs_expense(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _liability_types = [AccountType.mortgage, AccountType.loan]
    q = (
        select(
            extract("year", Transaction.date).label("year"),
            extract("month", Transaction.date).label("month"),
            Transaction.type,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_not(True),
            Transaction.type.in_([TransactionType.income, TransactionType.expense]),
            Transaction.transfer_account_id == None,
            Account.type.not_in(_liability_types),
        )
        .group_by("year", "month", Transaction.type)
        .order_by("year", "month")
    )
    if start_date:
        q = q.where(Transaction.date >= start_date)
    if end_date:
        q = q.where(Transaction.date <= end_date)

    result = await db.execute(q)
    rows = result.all()

    monthly: dict[str, dict] = {}
    for r in rows:
        key = f"{int(r.year)}-{int(r.month):02d}"
        if key not in monthly:
            monthly[key] = {"income": Decimal("0"), "expenses": Decimal("0")}
        if r.type == TransactionType.income:
            monthly[key]["income"] = r.total
        else:
            monthly[key]["expenses"] = r.total

    return [
        MonthlyIncomeExpense(
            month=k,
            income=v["income"],
            expenses=v["expenses"],
            net=v["income"] - v["expenses"],
        )
        for k, v in sorted(monthly.items())
    ]


@router.get("/monthly-trend", response_model=list[MonthlyTrend])
async def monthly_trend(
    months: int = Query(12, ge=1, le=60),
    category_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _liability_types = [AccountType.mortgage, AccountType.loan]
    year = extract("year", Transaction.date)
    month = extract("month", Transaction.date)
    q = (
        select(
            year.label("year"),
            month.label("month"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.deleted_at == None,
            Transaction.is_hidden.is_not(True),
            Transaction.type == TransactionType.expense,
            Transaction.transfer_account_id == None,
            Account.type.not_in(_liability_types),
        )
        .group_by("year", "month")
        .order_by(year.desc(), month.desc())
        .limit(months)
    )
    if category_id:
        q = q.where(Transaction.category_id == category_id)
    result = await db.execute(q)
    rows = reversed(result.all())
    return [
        MonthlyTrend(month=f"{int(r.year)}-{int(r.month):02d}", total=r.total)
        for r in rows
    ]


@router.get("/cash-flow", response_model=CashFlowReport)
async def cash_flow(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    monthly = await income_vs_expense(start_date, end_date, db, current_user)
    total_income = sum(m.income for m in monthly)
    total_expenses = sum(m.expenses for m in monthly)
    return CashFlowReport(
        total_income=total_income,
        total_expenses=total_expenses,
        net=total_income - total_expenses,
        by_month=monthly,
    )
