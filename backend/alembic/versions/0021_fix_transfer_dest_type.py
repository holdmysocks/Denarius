"""Fix transfer destination transactions incorrectly typed as income

Revision ID: 0021
Revises: 0020
Create Date: 2026-03-17 00:00:00.000000
"""
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE transactions
        SET type = 'transfer'
        WHERE transfer_account_id IS NOT NULL
          AND type = 'income'
          AND deleted_at IS NULL
        """
    )


def downgrade():
    # Cannot reliably revert: both source and destination legs have
    # transfer_account_id set and type='transfer', so we can't distinguish them.
    raise RuntimeError(
        "Downgrade is intentionally unsupported because the original transfer "
        "leg types cannot be reconstructed."
    )
