# Import all submodules so Alembic can discover ORM models for autogenerate
from . import (  # noqa: F401
    user,
    account,
    expense_account,
    mortgage_detail,
    category,
    transaction,
    budget,
    monthly_budget_total,
    app_setting,
    recurring_item,
    extra_expense,
    net_worth_snapshot,
    refresh_token,
)
