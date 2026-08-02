"""Add extra_expenses table for manual forecast entries

Manual running costs that have no recurring item behind them. They never post
transactions — they only feed the Forecast page totals.

Revision ID: 0024
Revises: 0023
Create Date: 2026-08-02 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM, UUID

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    sa.Enum("monthly", "yearly", name="extra_expense_frequency").create(
        op.get_bind(), checkfirst=True
    )
    # create_type=False: the type is created above, so don't let create_table
    # emit a second CREATE TYPE for the same name.
    extra_expense_frequency = ENUM(
        "monthly", "yearly", name="extra_expense_frequency", create_type=False
    )

    op.create_table(
        "extra_expenses",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column(
            "frequency",
            extra_expense_frequency,
            nullable=False,
            server_default="monthly",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_extra_expenses_active",
        "extra_expenses",
        ["is_active"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade():
    op.drop_index("ix_extra_expenses_active", table_name="extra_expenses")
    op.drop_table("extra_expenses")
    sa.Enum(name="extra_expense_frequency").drop(op.get_bind(), checkfirst=True)
