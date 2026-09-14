"""widen driver veh_type column

BUGFIX: saving a driver with more than one selected Vehicle Type (e.g.
"VAN / PICK-UP / 2-8 VAN / 2-8 PICK-UP") failed with
psycopg2.errors.StringDataRightTruncation - value too long for type
character varying(32).

Root cause: this is the same underlying bug migration 7a3f9c1e2b44 fixed
for vehicles.type, but that migration only widened vehicles.type - it
never touched drivers.veh_type, even though the Driver model's own inline
comment already documented this exact "VAN / PICK-UP"-joined multi-select
convention. Separately, the model file (app/models/fleet.py) and the
baseline migration's CREATE TABLE statement were at some point edited to
say String(64) for this column - but editing an already-applied
migration's source doesn't retroactively alter any database that already
ran it, so on a database that was provisioned before that edit, the real
column is still VARCHAR(32) (matching the StringDataRightTruncation error
this migration fixes) regardless of what the code claims. Because that
edit means we can't trust `existing_type` to accurately describe every
database this runs against, this migration only widens (never narrows)
the column, which is safe to run whether the live column is currently 32
or 64.

Widened to VARCHAR(255) - same width as vehicles.type (see 7a3f9c1e2b44)
for consistency, comfortably covers all 5 current vehicle types combined
(~44 chars) with generous room for future additions.

Revision ID: a5c8e01f4b17
Revises: f3a91d6e0b52
Create Date: 2026-08-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5c8e01f4b17'
down_revision: Union[str, None] = 'f3a91d6e0b52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No existing_type= pinned to a specific prior width on purpose (see
    # note above) - this widens the column regardless of whether the live
    # database currently has VARCHAR(32) or VARCHAR(64), and does not
    # touch/truncate/modify any existing row's data.
    op.alter_column('drivers', 'veh_type', type_=sa.String(255))


def downgrade() -> None:
    # NOTE: only safe if no existing row's `veh_type` value is currently
    # longer than 32 chars (i.e. no multi-select values were saved while
    # this migration was in effect) - Postgres will raise if truncation
    # would occur, same as the bug this migration fixes. Downgrading to
    # 64 (not 32) to match what the model/baseline migration source
    # currently declare, since that's the more likely "previous" width on
    # any database created after this project's veh_type comment/model
    # was last edited.
    op.alter_column('drivers', 'veh_type', type_=sa.String(64))
