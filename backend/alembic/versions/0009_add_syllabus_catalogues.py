"""Add shared, non-destructive syllabus catalogue records.

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-13
"""
# ruff: noqa: E501, PLR0913

from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def _seed_row(
    category: str, item_id: str, label: str, payload: dict[str, object], sort_order: int, parent_id: str | None = None
) -> dict[str, object]:
    now = datetime.now(UTC).isoformat()
    return {
        "id": item_id,
        "category": category,
        "parent_id": parent_id,
        "label": label,
        "payload": payload,
        "sort_order": sort_order,
        "is_retired": False,
        "retired_at": None,
        "revision": 1,
        "created_at": now,
        "updated_at": now,
    }


def upgrade() -> None:
    catalogue = op.create_table(
        "syllabus_catalogue_items",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("parent_id", sa.Text(), nullable=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column(
            "payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_retired", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("retired_at", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index(
        "syllabus_catalogue_items_category_active", "syllabus_catalogue_items", ["category", "is_retired", "sort_order"]
    )
    op.create_index(
        "syllabus_catalogue_items_parent", "syllabus_catalogue_items", ["category", "parent_id", "sort_order"]
    )

    programme_id = "programme-bsc-physics-quantum-technologies"
    rows = [
        _seed_row(
            "programmes",
            programme_id,
            "Bachelor in Physics – Concentration in Quantum Technologies",
            {"templateIds": ["scen-en-v1"]},
            1,
        ),
        _seed_row(
            "plos",
            "plo-bsc-physics-qt-1",
            "PLO 1",
            {
                "code": "PLO 1",
                "outcome": "Model, analyse and solve simple physics problems involving fundamental physics subjects.",
            },
            1,
            programme_id,
        ),
        _seed_row(
            "plos",
            "plo-bsc-physics-qt-2",
            "PLO 2",
            {
                "code": "PLO 2",
                "outcome": "Apply the scientific method, estimate orders of magnitude and critically analyse the result.",
            },
            2,
            programme_id,
        ),
        _seed_row(
            "plos",
            "plo-bsc-physics-qt-3",
            "PLO 3",
            {
                "code": "PLO 3",
                "outcome": "Develop innovative skills through projects and problem solving and use multiple resources to solve problems, including programming and computing.",
            },
            3,
            programme_id,
        ),
        _seed_row(
            "plos",
            "plo-bsc-physics-qt-4",
            "PLO 4",
            {
                "code": "PLO 4",
                "outcome": "Communicate the solution to a problem or the results of a scientific investigation using effective oral, written and presentation skills.",
            },
            4,
            programme_id,
        ),
        _seed_row(
            "plos",
            "plo-bsc-physics-qt-5",
            "PLO 5",
            {
                "code": "PLO 5",
                "outcome": "Design an experiment and accurately record, analyse, interpret, and critically evaluate the results.",
            },
            5,
            programme_id,
        ),
        _seed_row(
            "plos",
            "plo-bsc-physics-qt-6",
            "PLO 6",
            {
                "code": "PLO 6",
                "outcome": "Work collaboratively as well as in an independent and self-directed way, in different environments.",
            },
            6,
            programme_id,
        ),
    ]
    competency_labels = [
        "SCEN-C1 Scientific and Technical Expertise",
        "SCEN-C2 Analytical Thinking & Quantitative Reasoning",
        "SCEN-C3 Problem Solving & Innovation",
        "SCEN-C4 Data, Digital & AI Literacy",
        "SCEN-C5 Experimental & Technical Practice",
        "SCEN-C6 Communication",
        "SCEN-C7 Collaboration & Leadership",
        "SCEN-C8 Project & Resource Management",
        "SCEN-C9 Professionalism, Ethics, Sustainability",
        "SCEN-C10 Adaptability & Lifelong Learning",
    ]
    rows.extend(
        _seed_row("competencies", f"scen-competency-{index}", label, {"code": label.split(" ", 1)[0]}, index)
        for index, label in enumerate(competency_labels, start=1)
    )
    teaching_presets = (
        (
            "Lectures / Cours magistraux",
            "Instructor-led sessions designed to introduce and explain key concepts, theories, methods, and disciplinary frameworks. Lectures provide the foundational knowledge required for subsequent tutorials, laboratory work, and independent study.",
            "Students are expected to prepare for lectures by completing assigned readings and reviewing supporting materials when provided. During class, they should actively engage with the content by taking notes, asking questions, and participating in discussions where appropriate. Outside class, students are expected to consolidate their understanding through independent study, review of lecture materials, and completion of assigned exercises. Students should use instructor feedback to identify areas requiring additional effort and seek clarification when needed. Attendance is recorded at each lecture session in accordance with the programme attendance policy.",
            "Feedback is provided through in-class questioning, discussions, formative quizzes where applicable, and clarification of common misconceptions identified during lectures. Students are encouraged to use this feedback to monitor their understanding of core concepts and identify areas requiring further study. Additional feedback may be provided during office hours or individual consultations.",
        ),
        (
            "Problem-solving / TD",
            "Interactive small-group sessions in which students apply concepts introduced in lectures through exercises, case studies, guided problem-solving, discussions, and analytical activities. TDs reinforce understanding, develop critical thinking, and provide opportunities for feedback and clarification.",
            "Students are expected to arrive prepared, having reviewed the relevant lecture content and attempted assigned exercises. Active participation is essential and includes contributing to discussions, solving problems individually and collaboratively, explaining reasoning, and engaging constructively with peers. Independent work between sessions is expected to reinforce concepts and complete assigned activities. Students should actively reflect on feedback provided during exercises and discussions to improve their analytical and problem-solving skills. Attendance is monitored at each session and forms part of the expectations for successful completion of the course.",
            "TD sessions provide frequent formative feedback through guided problem-solving activities, instructor comments, and collective correction of exercises. Students receive feedback on their analytical approach, reasoning, methodology, and communication of solutions. They are expected to reflect on this feedback, correct errors, and apply the recommendations in subsequent exercises and assessments. Individual guidance may be provided during or after sessions to support academic progress.",
        ),
        (
            "Laboratory / TP",
            "Hands-on practical activities allowing students to apply theoretical knowledge through experiments, technical exercises, simulations, programming tasks, or the use of specialized equipment and software, and to report in writing. TPs develop methodological, technical, and data-analysis skills.",
            "Students must prepare by reviewing laboratory instructions, theoretical concepts, and safety procedures before each session. During laboratory work, students are expected to actively participate in experiments, data collection, analysis, and technical tasks while collaborating effectively with peers where applicable. Outside scheduled sessions, students may be required to complete laboratory reports, analyze results, and undertake additional research. Students should use instructor feedback on laboratory performance and reports to improve their methodological and technical competencies. Attendance is compulsory for laboratory sessions and is monitored through attendance records and completion of laboratory activities.",
            "Feedback is provided continuously during laboratory activities through observation, technical guidance, discussion of experimental procedures, and review of laboratory results. Laboratory reports and practical assignments receive written and/or oral feedback focusing on technical accuracy, data analysis, interpretation of results, and scientific methodology. Students are expected to use this feedback to improve both their practical skills and their ability to communicate scientific findings.",
        ),
        (
            "Project",
            "An individual or group-based learning activity in which students investigate a problem, design a solution, develop a product or study, and communicate their results. Projects encourage the integration of knowledge and skills while fostering autonomy, project management, teamwork, and professional communication competencies.",
            "Students are expected to take primary responsibility for planning, organizing, and completing project tasks. This includes conducting independent research, managing deadlines, applying course concepts, and contributing actively to teamwork when projects are group-based. Regular collaboration with peers, participation in project meetings, and constructive engagement with supervision sessions are expected. Students should incorporate feedback received throughout the project lifecycle into subsequent stages of their work and demonstrate continuous improvement. Attendance at scheduled project supervision meetings, presentations, and milestone reviews is monitored in accordance with programme requirements.",
            "Project feedback is delivered throughout the project lifecycle through supervision meetings, progress reviews, milestone evaluations, draft reviews, and presentations. Feedback focuses on project planning, methodological choices, technical implementation, teamwork, critical analysis, and communication. Students are expected to actively engage with feedback, demonstrate evidence of improvement between project stages, and incorporate recommendations into subsequent project deliverables. This iterative feedback process supports the development of independent learning, project management, and professional competencies.",
        ),
    )
    for index, (label, methods, engagement, feedback) in enumerate(teaching_presets, start=1):
        rows.append(
            _seed_row(
                "teaching-presets",
                f"teaching-preset-{index}",
                label,
                {"methods": methods, "engagement": engagement, "feedback": feedback},
                index,
            )
        )
    rubric_criteria = (
        (
            "Written test / examination",
            [
                "Knowledge and understanding of course content",
                "Application and problem-solving",
                "Analytical reasoning and critical thinking",
                "Methodological rigor and calculations (where applicable)",
                "Communication and presentation of answers",
            ],
        ),
        (
            "Laboratory report",
            [
                "Experimental work and data collection",
                "Data analysis and interpretation",
                "Scientific methodology and technical accuracy",
                "Discussion and critical evaluation",
                "Structure, presentation, and scientific communication",
            ],
        ),
        (
            "Project",
            [
                "Understanding of the subject",
                "Methodology and problem-solving approach",
                "Analysis, critical thinking, and quality of results",
                "Project management, autonomy, and teamwork",
                "Communication and presentation of the project",
            ],
        ),
    )
    for index, (label, criteria) in enumerate(rubric_criteria, start=1):
        assessment_id = f"assessment-type-{index}"
        rows.append(_seed_row("assessment-types", assessment_id, label, {}, index))
        rows.append(
            _seed_row(
                "rubric-presets",
                f"rubric-preset-{index}",
                label,
                {"assessmentTypeId": assessment_id, "criteria": criteria},
                index,
            )
        )
    rows.extend(
        _seed_row("bibliography-types", item_id, label, {"kind": kind}, index)
        for index, (item_id, label, kind) in enumerate(
            (
                ("bibliography-book", "Books", "book"),
                ("bibliography-website", "Websites", "website"),
                ("bibliography-journal-article", "Journal articles", "article"),
            ),
            start=1,
        )
    )
    op.bulk_insert(catalogue, rows)


def downgrade() -> None:
    op.drop_index("syllabus_catalogue_items_parent", table_name="syllabus_catalogue_items")
    op.drop_index("syllabus_catalogue_items_category_active", table_name="syllabus_catalogue_items")
    op.drop_table("syllabus_catalogue_items")
