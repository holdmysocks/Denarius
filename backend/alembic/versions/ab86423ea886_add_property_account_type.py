"""add property account type

Revision ID: ab86423ea886
Revises: 0008
Create Date: 2026-03-04 16:22:02.769097

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ab86423ea886'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE must run outside a transaction block (asyncpg requirement)
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'property'")


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade is intentionally unsupported: PostgreSQL enum values cannot "
        "be removed safely while property accounts may exist."
    )
