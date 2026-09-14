"""Which programme outcomes each course is expected to address.

The curriculum map submitted to the CAA says, for a programme, which PLOs each of
its courses carries. Holding it here lets a syllabus show a professor what is still
uncovered by their course outcomes — as guidance, never as a gate.

Seeded from "BScPhys-Goals-PLO-CLO".

Revision ID: 0051
Revises: 0050
Create Date: 2026-09-10
"""

from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None

PROGRAMME_ID = "programme-bsc-physics-quantum-technologies"

CURRICULUM_MAP = [
    {"courseCode": "MATH100", "courseTitle": "Mathematics 1", "plos": ["PLO1", "PLO3"], "semester": "L1-S1"},
    {
        "courseCode": "PHYS125",
        "courseTitle": "Mechanics-Physics 1",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L1-S1",
    },
    {
        "courseCode": "PHYS118",
        "courseTitle": "Geometric Optics",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L1-S1",
    },
    {
        "courseCode": "CPSC100",
        "courseTitle": "Computer Science",
        "plos": ["PLO1", "PLO3", "PLO4", "PLO6"],
        "semester": "L1-S1",
    },
    {"courseCode": "PHYS105", "courseTitle": "Intro to World of Work 1", "plos": ["PLO4", "PLO6"], "semester": "L1-S1"},
    {"courseCode": "MATH200", "courseTitle": "Mathematics 2", "plos": ["PLO1", "PLO3"], "semester": "L1-S2"},
    {
        "courseCode": "PHYS126",
        "courseTitle": "Mechanics-Physics 2",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L1-S2",
    },
    {"courseCode": "PHYS140", "courseTitle": "Active Science", "plos": ["PLO3", "PLO4", "PLO6"], "semester": "L1-S2"},
    {
        "courseCode": "PHYS119",
        "courseTitle": "Introduction to Electronics",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L1-S2",
    },
    {
        "courseCode": "PHYS117",
        "courseTitle": "Discipline 2: Chemistry",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L1-S2",
    },
    {
        "courseCode": "PHYS210",
        "courseTitle": "Mathematics for Physics 1",
        "plos": ["PLO1", "PLO3"],
        "semester": "L2-S3",
    },
    {
        "courseCode": "PHYS219",
        "courseTitle": "Advanced Mechanics and Special Relativity",
        "plos": ["PLO1", "PLO2", "PLO3"],
        "semester": "L2-S3",
    },
    {
        "courseCode": "PHYS208",
        "courseTitle": "Thermodynamics",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L2-S3",
    },
    {
        "courseCode": "PHYS216",
        "courseTitle": "Numerical Physics",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L2-S3",
    },
    {
        "courseCode": "PHYS221",
        "courseTitle": "Sensors and Instrumentation",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L2-S3",
    },
    {
        "courseCode": "PHYS211",
        "courseTitle": "Mathematics for Physics 2",
        "plos": ["PLO1", "PLO3"],
        "semester": "L2-S4",
    },
    {
        "courseCode": "PHYS218",
        "courseTitle": "Mathematics for Physics 3",
        "plos": ["PLO1", "PLO3"],
        "semester": "L2-S4",
    },
    {
        "courseCode": "PHYS213",
        "courseTitle": "Electromagnetism",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L2-S4",
    },
    {
        "courseCode": "PHYS203",
        "courseTitle": "Waves",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L2-S4",
    },
    {
        "courseCode": "PHYS220",
        "courseTitle": "Introduction to Quantum Physics",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L2-S4",
    },
    {
        "courseCode": "PHYS222",
        "courseTitle": "Measurement & Data Analysis",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L2-S4",
    },
    {
        "courseCode": "PHYS316",
        "courseTitle": "Mathematics for Physics 4",
        "plos": ["PLO1", "PLO3"],
        "semester": "L3-S5",
    },
    {
        "courseCode": "PHYS303",
        "courseTitle": "Quantum Physics 1",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L3-S5",
    },
    {
        "courseCode": "PHYS305",
        "courseTitle": "Optics and Electromagnetism",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L3-S5",
    },
    {
        "courseCode": "PHYS302",
        "courseTitle": "Experimental Methods in Spectroscopy",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L3-S5",
    },
    {
        "courseCode": "PHYS318",
        "courseTitle": "Spectroscopy",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L3-S5",
    },
    {"courseCode": "PHYS315", "courseTitle": "Intro to World of Work 2", "plos": ["PLO4", "PLO6"], "semester": "L3-S5"},
    {"courseCode": "PHYS307", "courseTitle": "Quantum Physics 2", "plos": ["PLO1", "PLO3"], "semester": "L3-S6"},
    {"courseCode": "PHYS301", "courseTitle": "Thermostatistics", "plos": ["PLO1", "PLO3"], "semester": "L3-S6"},
    {
        "courseCode": "PHYS322",
        "courseTitle": "Experimental and Numerical Project",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L3-S6",
    },
    {"courseCode": "PHYS319", "courseTitle": "Quantum Information", "plos": ["PLO1", "PLO3"], "semester": "L3-S6"},
    {"courseCode": "PHYS317", "courseTitle": "Astrophysics", "plos": ["PLO1", "PLO2"], "semester": "L3-S6"},
    {
        "courseCode": "PHYS310",
        "courseTitle": "Internship",
        "plos": ["PLO1", "PLO2", "PLO3", "PLO4", "PLO5", "PLO6"],
        "semester": "L3-S6",
    },
]


def upgrade() -> None:
    connection = op.get_bind()
    programme = connection.execute(
        sa.text("SELECT id FROM syllabus_catalogue_items WHERE id = :id"), {"id": PROGRAMME_ID}
    ).scalar()
    if programme is None:
        return
    plo_ids = {
        str(row[1] or "").replace(" ", "").upper(): row[0]
        for row in connection.execute(
            sa.text(
                "SELECT id, COALESCE(payload->>'code', label) FROM syllabus_catalogue_items"
                " WHERE category = 'plos' AND parent_id = :programme"
            ),
            {"programme": PROGRAMME_ID},
        )
    }
    stamp = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    existing = {row[0] for row in connection.execute(sa.text("SELECT id FROM syllabus_catalogue_items"))}
    catalogue = sa.table(
        "syllabus_catalogue_items",
        sa.column("payload", postgresql.JSONB),
        *(
            sa.column(name)
            for name in (
                "id",
                "category",
                "parent_id",
                "label",
                "sort_order",
                "is_retired",
                "retired_at",
                "revision",
                "created_at",
                "updated_at",
            )
        ),
    )
    rows = []
    for index, course in enumerate(CURRICULUM_MAP, start=1):
        item_id = f"curriculum-map-{course['courseCode'].lower()}"
        if item_id in existing:
            continue
        wanted = [
            plo_ids[code.replace(" ", "").upper()]
            for code in course["plos"]
            if code.replace(" ", "").upper() in plo_ids
        ]
        rows.append(
            {
                "id": item_id,
                "category": "curriculum-mapping",
                "parent_id": PROGRAMME_ID,
                "label": course["courseCode"],
                "payload": {"courseTitle": course["courseTitle"], "semester": course["semester"], "ploIds": wanted},
                "sort_order": index,
                "is_retired": False,
                "retired_at": None,
                "revision": 1,
                "created_at": stamp,
                "updated_at": stamp,
            }
        )
    if rows:
        op.bulk_insert(catalogue, rows)


def downgrade() -> None:
    op.execute("DELETE FROM syllabus_catalogue_items WHERE category = 'curriculum-mapping'")
