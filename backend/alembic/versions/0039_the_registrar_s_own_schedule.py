"""Where the registrar has actually booked our sections, as dated meetings.

The third record. Our planning says which group teaches which course under which CRN; the
register says who is enrolled in it; this says when and where it meets, according to
Facilities. Nothing has ever compared the three, and the one thing that could — a
timetable exported from the registrar and uploaded by hand into the Student Hub at the
start of term — is a photograph taken in week one.

Two decisions are built into these tables and both are load-bearing.

**Meetings are dated, not weekly.** A course running weeks 1-7 and one running weeks 8-15
in the same room and hour never share a date, so they can never be reported as clashing —
without any notion of a "handover" having to be invented. It also means
`services/group_clashes.py` works on this data unchanged: its input is already
`Session(crn, date, start, end)`. Folding to a weekly pattern is for display, and belongs
in the browser.

**Silence is written down.** Pulling too fast made the portal return an empty list for
about one section in seven — indistinguishable from a section that genuinely has no
classes booked. So a section we asked about and got nothing for is `silent`, a section
nobody has asked about has no row at all, and the difference is a fact rather than an
inference. Without it a failed pull looks exactly like the registrar cancelling a term.

`facility_pulls` records what each pull asked and answered, so a partial pull can never be
mistaken for the registrar dropping everything it did not mention.

Revision ID: 0039
Revises: 0038
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "facility_sections",
        # The portal's own pair, which is also what portal_courses and active_course_crns
        # key on — so this joins to both without a translation.
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column("crn", sa.Text(), primary_key=True),
        sa.Column("course_code", sa.Text(), nullable=False, server_default=""),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("teacher_name", sa.Text(), nullable=False, server_default=""),
        # Rooms as the registrar spells them, comma-joined: a section can meet in two.
        sa.Column("rooms", sa.Text(), nullable=False, server_default=""),
        # published · silent · gone. A section with no row at all is "unchecked", which is
        # a fourth state and deliberately not stored: absence is the honest way to say it.
        # Not called `status`, because portal_courses and student_registrations both have a
        # `status` meaning "the portal still lists this", which is a different question.
        sa.Column("schedule_state", sa.Text(), nullable=False, server_default="published"),
        # Whether this is one of ours, from active_course_crns at pull time. Stored rather
        # than derived so a section that leaves the register keeps its history.
        sa.Column("ours", sa.Boolean(), nullable=False, server_default=sa.false()),
        # Students the registrar shows in it, when the pull could tell. NULL when it could
        # not — a mid-term add makes the ratio non-integral, and a wrong number is worse
        # than none. Never stored for a section that is not ours: another department's
        # enrolment is a fact about them.
        sa.Column("head_count", sa.Integer(), nullable=True),
        # How many consecutive complete pulls have come back empty. A section is only
        # treated as gone at two, so one bad pull does not retire a term's teaching.
        sa.Column("silent_pulls", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("asked_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("first_seen_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("last_seen_at", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("facility_sections_course", "facility_sections", ["term_code", "course_code"])

    op.create_table(
        "facility_meetings",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("crn", sa.Text(), nullable=False),
        # ISO date and 24-hour times, as strings, because that is what group_clashes
        # compares and what the Hub's own sessions already are. Comparing them as text is
        # correct for ISO and avoids a timezone this data does not have.
        sa.Column("meets_on", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.Text(), nullable=False),
        sa.Column("ends_at", sa.Text(), nullable=False),
        sa.Column("room", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(
            ["term_code", "crn"], ["facility_sections.term_code", "facility_sections.crn"], ondelete="CASCADE"
        ),
    )
    op.create_index("facility_meetings_section", "facility_meetings", ["term_code", "crn"])
    # Room is NOT in the uniqueness: a meeting that moves room is the same meeting moved,
    # and keying on the room would leave the old one behind for ever, which manufactures a
    # permanent clash against a class that is not there. Meetings are replaced per section
    # per pull rather than merged; this only stops a single pull duplicating one.
    op.create_unique_constraint(
        "facility_meetings_once",
        "facility_meetings",
        ["term_code", "crn", "meets_on", "starts_at", "ends_at"],
    )

    op.create_table(
        "facility_pulls",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column("pulled_at", sa.Text(), nullable=False),
        sa.Column("pulled_by", sa.Text(), nullable=False, server_default=""),
        # What it asked for and what came back. `complete` is what licences a silence to
        # count: a pull that gave up half way says nothing about the sections it never
        # reached, and must never retire them.
        sa.Column("asked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("answered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("silent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("complete", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "section_collision_notes",
        # Once per colliding pair of sections, not once per student caught by it: five of
        # our own sections in the university's protected Tuesday option slot is one fact
        # about the slot, and reporting it per student is a wall of red nobody can clear.
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column("our_crn", sa.Text(), primary_key=True),
        sa.Column("their_crn", sa.Text(), primary_key=True),
        sa.Column("weekday", sa.Text(), primary_key=True),
        sa.Column("starts_at", sa.Text(), primary_key=True),
        sa.Column("ends_at", sa.Text(), primary_key=True),
        # accepted · referred. Settled either way it leaves the count, so the screen can
        # reach zero; moving our own section out of the slot removes the collision itself.
        sa.Column("disposition", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("settled_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("settled_by", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("section_collision_notes")
    op.drop_table("facility_pulls")
    op.drop_constraint("facility_meetings_once", "facility_meetings", type_="unique")
    op.drop_index("facility_meetings_section", table_name="facility_meetings")
    op.drop_table("facility_meetings")
    op.drop_index("facility_sections_course", table_name="facility_sections")
    op.drop_table("facility_sections")
