"""Add 'semiannually' to the recurring_frequency enum

Recurring items that bill twice a year (insurance premiums, some memberships)
previously had to be modelled as quarterly or annual, which threw off both the
next-due-date arithmetic and the forecast totals.

Revision ID: 0025
Revises: 0024
Create Date: 2026-08-03 00:00:00.000000
"""
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    # Postgres 12+ allows ALTER TYPE ... ADD VALUE inside a transaction as long
    # as the new value isn't used in that same transaction — it isn't here.
    op.execute(
        "ALTER TYPE recurring_frequency ADD VALUE IF NOT EXISTS 'semiannually' BEFORE 'annually'"
    )


def downgrade():
    # Postgres cannot drop a single enum value, so rebuild the type without it.
    # Any rows still on 'semiannually' fall back to 'quarterly'.
    op.execute(
        "UPDATE recurring_items SET frequency = 'quarterly' WHERE frequency = 'semiannually'"
    )
    op.execute("ALTER TYPE recurring_frequency RENAME TO recurring_frequency_old")
    op.execute(
        "CREATE TYPE recurring_frequency AS ENUM "
        "('weekly', 'biweekly', 'monthly', 'quarterly', 'annually')"
    )
    op.execute(
        "ALTER TABLE recurring_items ALTER COLUMN frequency "
        "TYPE recurring_frequency USING frequency::text::recurring_frequency"
    )
    op.execute("DROP TYPE recurring_frequency_old")
