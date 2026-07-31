"""Soft-delete all legacy type=transfer transactions and clear paired refs

Transfers are now stored as expense/income pairs. Existing transfer-typed
transactions are orphaned by this change, so we soft-delete them. Users can
manually correct account balances via "Set Balance" and recreate transfers.

Revision ID: 0022
Revises: 0021
Create Date: 2026-03-18 00:00:00.000000
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    # Clear paired_transaction_id on any remaining non-deleted transactions
    # that reference a transfer (prevents FK issues)
    conn.execute(
        sa.text("""
            UPDATE transactions
            SET paired_transaction_id = NULL
            WHERE paired_transaction_id IS NOT NULL
              AND deleted_at IS NULL
        """)
    )

    # Soft-delete all type='transfer' transactions
    conn.execute(
        sa.text("""
            UPDATE transactions
            SET deleted_at = :now
            WHERE type = 'transfer'
              AND deleted_at IS NULL
        """),
        {"now": now},
    )


def downgrade():
    # Cannot reliably restore soft-deleted transfers
    raise RuntimeError(
        "Downgrade is intentionally unsupported because the soft-deleted legacy "
        "transfers and cleared pair links cannot be reconstructed."
    )
