"""widen vehicle type column

BUGFIX: saving a vehicle with more than one selected vehicle type (e.g.
"VAN / 2-8 PICK-UP / PICK-UP / 2-8 VAN") failed with
psycopg2.errors.StringDataRightTruncation - value too long for type
character varying(32). The model's own inline comment already documented
this field as holding multi-select, " / "-joined values, but the actual
column was left at VARCHAR(32), too narrow to hold more than one type.
Widened to VARCHAR(255) - comfortably covers all 5 current vehicle types
combined (~44 chars) with generous room for future additions, matching
the width used for other free-form/joined text fields elsewhere in this
schema (e.g. drivers.anchor_area).

Revision ID: 7a3f9c1e2b44
Revises: fbddcc3bbc43
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7a3f9c1e2b44'
down_revision: Union[str, None] = 'fbddcc3bbc43'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('vehicles', 'type', type_=sa.String(255), existing_type=sa.String(32))


def downgrade() -> None:
    # NOTE: only safe if no existing row's `type` value is currently
    # longer than 32 chars (i.e. no multi-select values were saved while
    # this migration was in effect) - Postgres will raise if truncation
    # would occur, same as the bug this migration fixes.
    op.alter_column('vehicles', 'type', type_=sa.String(32), existing_type=sa.String(255))
