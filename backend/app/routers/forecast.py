import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db
from app.models.budget import Budget
from app.models.extra_expense import ExtraExpense, ExtraExpenseFrequency
from app.models.recurring_item import RecurringFrequency, RecurringItem, RecurringType
from app.models.user import User
from app.routers.system import get_app_date
from app.schemas.forecast import (
    ExtraExpenseCreate,
    ExtraExpenseOut,
    ExtraExpenseUpdate,
    ForecastGroup,
    ForecastLine,
    ForecastOut,
)
from app.utils.date_utils import first_of_month

router = APIRouter(prefix="/forecast", tags=["forecast"])

# Occurrences per year for each recurring cadence. Monthly-equivalent is
# derived from the yearly figure so the two views always reconcile
# (monthly * 12 == yearly), instead of drifting on 4-week months.
OCCURRENCES_PER_YEAR: dict[RecurringFrequency, Decimal] = {
    RecurringFrequency.weekly: Decimal("52"),
    RecurringFrequency.biweekly: Decimal("26"),
    RecurringFrequency.monthly: Decimal("12"),
    RecurringFrequency.quarterly: Decimal("4"),
    RecurringFrequency.annually: Decimal("1"),
}

EXTRA_OCCURRENCES_PER_YEAR: dict[ExtraExpenseFrequency, Decimal] = {
    ExtraExpenseFrequency.monthly: Decimal("12"),
    ExtraExpenseFrequency.yearly: Decimal("1"),
}

_CENTS = Decimal("0.01")


def _money(value: Decimal) -> float:
    return float(value.quantize(_CENTS, rounding=ROUND_HALF_UP))


def _line(
    *,
    item_id: str,
    name: str,
    source: str,
    frequency: str,
    amount: Decimal,
    per_year: Decimal,
    category_name: str | None = None,
    account_name: str | None = None,
) -> ForecastLine:
    yearly = abs(amount) * per_year
    return ForecastLine(
        id=item_id,
        name=name,
        source=source,
        frequency=frequency,
        amount=_money(abs(amount)),
        monthly_amount=_money(yearly / Decimal("12")),
        yearly_amount=_money(yearly),
        category_name=category_name,
        account_name=account_name,
    )


def _group(key: str, label: str, lines: list[ForecastLine]) -> ForecastGroup:
    ordered = sorted(lines, key=lambda line: line.yearly_amount, reverse=True)
    return ForecastGroup(
        key=key,
        label=label,
        monthly_total=_money(Decimal(str(sum(line.monthly_amount for line in ordered)))),
        yearly_total=_money(Decimal(str(sum(line.yearly_amount for line in ordered)))),
        items=ordered,
    )


@router.get("", response_model=ForecastOut)
async def get_forecast(
    include_budgets: bool = Query(
        False,
        description="Also count this month's category budgets as expenses.",
    ),
    budget_month: date | None = Query(
        None, description="Month to pull budgets from. Defaults to the current app month."
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Normalised monthly/yearly income vs. expenses.

    Sources: active recurring items (income vs. bills + subscriptions), manual
    extra expenses, and — opt-in — the category budgets for a given month.
    """
    today = await get_app_date(db)

    recurring_result = await db.execute(
        select(RecurringItem)
        .options(selectinload(RecurringItem.category), selectinload(RecurringItem.account))
        .where(
            RecurringItem.deleted_at.is_(None),
            RecurringItem.is_active.is_(True),
        )
    )
    recurring_items = recurring_result.scalars().all()

    income_lines: list[ForecastLine] = []
    bill_lines: list[ForecastLine] = []
    subscription_lines: list[ForecastLine] = []
    expense_category_ids: set[uuid.UUID] = set()

    for item in recurring_items:
        per_year = OCCURRENCES_PER_YEAR.get(item.frequency)
        if per_year is None:
            continue
        line = _line(
            item_id=str(item.id),
            name=item.name,
            source="recurring",
            frequency=item.frequency.value,
            amount=item.amount,
            per_year=per_year,
            category_name=item.category.name if item.category else None,
            account_name=item.account.name if item.account else None,
        )
        if item.type == RecurringType.income:
            income_lines.append(line)
        else:
            if item.category_id:
                expense_category_ids.add(item.category_id)
            if item.type == RecurringType.subscription:
                subscription_lines.append(line)
            else:
                bill_lines.append(line)

    extras_result = await db.execute(
        select(ExtraExpense).where(
            ExtraExpense.deleted_at.is_(None),
            ExtraExpense.is_active.is_(True),
        )
    )
    extra_lines = [
        _line(
            item_id=str(extra.id),
            name=extra.name,
            source="extra",
            frequency=extra.frequency.value,
            amount=extra.amount,
            per_year=EXTRA_OCCURRENCES_PER_YEAR[extra.frequency],
        )
        for extra in extras_result.scalars().all()
    ]

    expense_groups = [
        _group("bills", "Bills", bill_lines),
        _group("subscriptions", "Subscriptions", subscription_lines),
        _group("extras", "Extra Expenses", extra_lines),
    ]

    resolved_budget_month: date | None = None
    overlap_count = 0
    if include_budgets:
        resolved_budget_month = first_of_month(budget_month or today)
        budgets_result = await db.execute(
            select(Budget)
            .options(selectinload(Budget.category))
            .where(Budget.month == resolved_budget_month)
        )
        budget_lines: list[ForecastLine] = []
        for budget in budgets_result.scalars().all():
            if budget.category_id in expense_category_ids:
                overlap_count += 1
            budget_lines.append(
                _line(
                    item_id=str(budget.id),
                    name=budget.category.name if budget.category else "Uncategorized",
                    source="budget",
                    frequency="monthly",
                    amount=budget.amount,
                    per_year=Decimal("12"),
                    category_name=budget.category.name if budget.category else None,
                )
            )
        expense_groups.append(_group("budgets", "Category Budgets", budget_lines))

    income = _group("income", "Income", income_lines)
    expenses_monthly = Decimal(str(sum(g.monthly_total for g in expense_groups)))
    expenses_yearly = Decimal(str(sum(g.yearly_total for g in expense_groups)))

    return ForecastOut(
        as_of=today,
        income=income,
        expense_groups=expense_groups,
        income_monthly=income.monthly_total,
        income_yearly=income.yearly_total,
        expenses_monthly=_money(expenses_monthly),
        expenses_yearly=_money(expenses_yearly),
        net_monthly=_money(Decimal(str(income.monthly_total)) - expenses_monthly),
        net_yearly=_money(Decimal(str(income.yearly_total)) - expenses_yearly),
        budgets_included=include_budgets,
        budget_month=resolved_budget_month,
        budget_overlap_count=overlap_count,
    )


@router.get("/extra-expenses", response_model=list[ExtraExpenseOut])
async def list_extra_expenses(
    is_active: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(ExtraExpense).where(ExtraExpense.deleted_at.is_(None))
    if is_active is not None:
        q = q.where(ExtraExpense.is_active.is_(is_active))
    result = await db.execute(q.order_by(ExtraExpense.created_at))
    return result.scalars().all()


@router.post("/extra-expenses", response_model=ExtraExpenseOut, status_code=201)
async def create_extra_expense(
    data: ExtraExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    extra = ExtraExpense(**data.model_dump(), created_by=current_user.id)
    db.add(extra)
    await db.commit()
    await db.refresh(extra)
    return extra


@router.put("/extra-expenses/{extra_id}", response_model=ExtraExpenseOut)
async def update_extra_expense(
    extra_id: uuid.UUID,
    data: ExtraExpenseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    extra = await _get_or_404(extra_id, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is None and field in ("name", "amount", "frequency", "is_active"):
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")
        setattr(extra, field, value)
    await db.commit()
    await db.refresh(extra)
    return extra


@router.delete("/extra-expenses/{extra_id}", status_code=204)
async def delete_extra_expense(
    extra_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    extra = await _get_or_404(extra_id, db)
    extra.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def _get_or_404(extra_id: uuid.UUID, db: AsyncSession) -> ExtraExpense:
    result = await db.execute(
        select(ExtraExpense).where(
            ExtraExpense.id == extra_id, ExtraExpense.deleted_at.is_(None)
        )
    )
    extra = result.scalar_one_or_none()
    if not extra:
        raise HTTPException(status_code=404, detail="Extra expense not found")
    return extra
