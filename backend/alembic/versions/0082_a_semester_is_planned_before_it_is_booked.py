"""A semester is planned before it is booked.

Until now the department's timetable began as the registrar's: the timetabling team built a
first version on the portal, the sweep stored it, and everything here — the calendars, the
clashes, the hours — read that. The department's own word was the course cards: who teaches
which group, how many hours, a preference for mornings. Never a day, a time, or a room.

A plan is that word written as a timetable. Coordinators place each class of a semester on a
week calendar, repeat it over the teaching weeks, and send the result to the timetabling
team; once the registrar has booked it, the two can be compared class by class.

It is kept against the registrar's term code ("262720"), not a Student Hub semester, because
a Hub semester is created by importing the registrar's timetable — which is exactly what does
not exist yet when a semester is being planned.

    plan_terms           the semester being planned: its teaching weeks and its holidays
    plan_sections        the classes to place, one per CRN: course, teacher, hours asked for
    plan_series          a class placed on the calendar: a weekday, an hour, a room, and the
                         teaching weeks it repeats on (one week for a class that happens once)
    plan_series_moves    one week of a series changed on its own: moved to another day, hour
                         or room, or given to another teacher

Weeks are teaching weeks, not dates, so a plan follows its semester's calendar: moving Week 1
or adding a break moves every class with it, the way the timetable counts them already.

Revision ID: 0082
Revises: 0081
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0082"
down_revision = "0081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plan_terms",
        # The registrar's term code: "262720" is the second semester of 2026-27.
        sa.Column("term_code", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        # Any day of the first teaching week; empty until somebody says.
        sa.Column("week_one", sa.Text(), nullable=False, server_default=""),
        # How many teaching weeks the semester has, breaks not counted.
        sa.Column("weeks", sa.Integer(), nullable=False, server_default="0"),
        # The Mondays of the weeks without classes, as JSON: ["2027-03-22"].
        sa.Column("without", sa.Text(), nullable=False, server_default="[]"),
        # Single days without classes, as JSON: [{"date": "2027-03-10", "label": "Eid"}].
        sa.Column("holidays", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "plan_sections",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "term_code",
            sa.Text(),
            sa.ForeignKey("plan_terms.term_code", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("crn", sa.Text(), nullable=False, server_default=""),
        sa.Column("parent_crn", sa.Text(), nullable=False, server_default=""),
        # "MATH-002", as the portal writes it.
        sa.Column("course_code", sa.Text(), nullable=False, server_default=""),
        # The class as the department names it: "Elements of Calculus TD-G1".
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("ue", sa.Text(), nullable=False, server_default=""),
        # CM, TD, TP, Project — as written.
        sa.Column("component", sa.Text(), nullable=False, server_default=""),
        # Who it is for, as JSON: ["L1"]; a French group shared by three years names all three.
        sa.Column("programmes", sa.Text(), nullable=False, server_default="[]"),
        # "G1", "GA"; empty where the whole programme attends.
        sa.Column("group_label", sa.Text(), nullable=False, server_default=""),
        sa.Column("teacher_name", sa.Text(), nullable=False, server_default=""),
        # The hours asked for, as a number where the request gives one…
        sa.Column("hours", sa.Float(), nullable=True),
        # …and as the request wrote them: "60CM", "45 TD".
        sa.Column("hours_said", sa.Text(), nullable=False, server_default=""),
        sa.Column("comments", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index(
        "plan_sections_crn",
        "plan_sections",
        ["term_code", "crn"],
        unique=True,
        postgresql_where=sa.text("crn <> ''"),
    )
    op.create_table(
        "plan_series",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("term_code", sa.Text(), nullable=False),
        sa.Column(
            "section_id",
            sa.Text(),
            sa.ForeignKey("plan_sections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # 1 is Monday, 7 is Sunday.
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.Text(), nullable=False),
        sa.Column("ends_at", sa.Text(), nullable=False),
        sa.Column("room", sa.Text(), nullable=False, server_default=""),
        # Empty: the section's own teacher.
        sa.Column("teacher_name", sa.Text(), nullable=False, server_default=""),
        # The teaching weeks it meets in, as JSON: [1, 2, 3, …].
        sa.Column("weeks", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        # Bumped by every change, so two people editing one class find out.
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
        sa.CheckConstraint("weekday BETWEEN 1 AND 7", name="plan_series_weekday"),
        sa.CheckConstraint("starts_at < ends_at", name="plan_series_hours"),
    )
    op.create_index("plan_series_term", "plan_series", ["term_code"])
    op.create_table(
        "plan_series_moves",
        sa.Column(
            "series_id",
            sa.Text(),
            sa.ForeignKey("plan_series.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("week", sa.Integer(), primary_key=True),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.Text(), nullable=False),
        sa.Column("ends_at", sa.Text(), nullable=False),
        sa.Column("room", sa.Text(), nullable=False, server_default=""),
        sa.Column("teacher_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.Text(), nullable=False, server_default=""),
        sa.CheckConstraint("weekday BETWEEN 1 AND 7", name="plan_series_moves_weekday"),
        sa.CheckConstraint("starts_at < ends_at", name="plan_series_moves_hours"),
    )


def downgrade() -> None:
    op.drop_table("plan_series_moves")
    op.drop_index("plan_series_term", table_name="plan_series")
    op.drop_table("plan_series")
    op.drop_index("plan_sections_crn", table_name="plan_sections")
    op.drop_table("plan_sections")
    op.drop_table("plan_terms")
