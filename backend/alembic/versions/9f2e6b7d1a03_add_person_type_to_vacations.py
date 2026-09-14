"""add person_type to vacations

Vacation records didn't distinguish between Drivers and Helpers - both
shared the same person_code/person_name fields with no way to tell which
roster a given vacation entry belongs to. Adds person_type ("Driver" /
"Helper"), defaulting existing rows to "Driver" (the more common case)
so no existing data is lost or ambiguous after this migration - any rows
that are actually Helper vacations can be corrected via the UI's new
Driver/Helper selector.

Revision ID: 9f2e6b7d1a03
Revises: 7a3f9c1e2b44
Create Date: 2026-08-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f2e6b7d1a03'
down_revision: Union[str, None] = '7a3f9c1e2b44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('vacations', sa.Column('person_type', sa.String(16), nullable=False, server_default='Driver'))
    op.alter_column('vacations', 'person_type', server_default=None)


def downgrade() -> None:
    op.drop_column('vacations', 'person_type')
