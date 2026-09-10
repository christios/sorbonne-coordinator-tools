"""Graduate competencies, the SCEN mapping, rubric bands, and the missing assessment types.

Seeds the SUAD graduate competencies as their own catalogue so a SCEN competency can
point at the ones it develops, exactly as a CLO points at programme learning outcomes.
Fills the grading rubrics from "Section 9-5-Grading rubrics" and adds the assessment
types the department actually uses (quiz, oral presentation, report, other).

Existing rows are only filled in where they are still empty, so a coordinator's own
edits in the catalogue survive this migration.

Revision ID: 0044
Revises: 0043
Create Date: 2026-08-31
"""

from datetime import UTC, datetime
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


GRADUATE_COMPETENCIES = {1: 'Intellectual autonomy and self-awareness',
 2: 'Professional responsibility, rigor, integrity and resilience',
 3: 'Adaptive and creative decision making',
 4: 'Critical, intercultural and ethical reasoning',
 5: 'Respectful, empathic and effective communication',
 6: 'Collaborative leadership and initiative',
 7: 'Digital literacy and project management skills'}

SCEN_COMPETENCIES = [{'code': 'SCEN-C1',
  'description': 'Applies disciplinary knowledge, theories, methods, and tools to understand and solve '
                 'scientific or technical problems.',
  'graduate': [1],
  'name': 'Scientific and Technical Expertise'},
 {'code': 'SCEN-C2',
  'description': 'Uses logical, mathematical, and statistical approaches to analyze information and support '
                 'decision-making.',
  'graduate': [1, 3, 7],
  'name': 'Analytical Thinking and Quantitative Reasoning'},
 {'code': 'SCEN-C3',
  'description': 'Identifies challenges, evaluates alternatives, and develops effective and creative '
                 'solutions.',
  'graduate': [2],
  'name': 'Problem Solving and Innovation'},
 {'code': 'SCEN-C4',
  'description': 'Collects, manages, analyzes, and interprets data using digital tools and AI technologies '
                 'responsibly and effectively.',
  'graduate': [2],
  'name': 'Data, Digital, and AI Literacy'},
 {'code': 'SCEN-C5',
  'description': 'Applies scientific methods, laboratory techniques, technical procedures, and quality '
                 'standards.',
  'graduate': [1],
  'name': 'Experimental and Technical Practice'},
 {'code': 'SCEN-C6',
  'description': 'Communicates scientific, technical, and professional information effectively to diverse '
                 'audiences.',
  'graduate': [4, 5],
  'name': 'Communication'},
 {'code': 'SCEN-C7',
  'description': 'Works effectively in teams, demonstrates initiative, and contributes to achieving shared '
                 'objectives.',
  'graduate': [4, 6],
  'name': 'Collaboration and Leadership'},
 {'code': 'SCEN-C8',
  'description': 'Plans, organizes, and manages tasks, time, resources, and priorities to achieve goals.',
  'graduate': [7],
  'name': 'Project and Resource Management'},
 {'code': 'SCEN-C9',
  'description': 'Acts responsibly, ethically, and with awareness of societal, environmental, and '
                 'professional impacts.',
  'graduate': [2, 4],
  'name': 'Professionalism, Ethics, and Sustainability'},
 {'code': 'SCEN-C10',
  'description': 'Demonstrates curiosity, resilience, continuous learning, and the ability to adapt to '
                 'technological and professional change.',
  'graduate': [2],
  'name': 'Adaptability and Lifelong Learning'}]

RUBRICS = {'Laboratory report': [{'exceeds': 'Procedures executed rigorously; data complete, accurate, and carefully '
                                   'documented.',
                        'inadequate': 'Experimental procedures inadequately followed; data incomplete or '
                                      'unreliable.',
                        'meets': 'Procedures followed appropriately; data generally complete and reliable.',
                        'name': 'Experimental Work and Data Collection'},
                       {'exceeds': 'Thorough and insightful analysis demonstrating strong understanding of '
                                   'the underlying principles.',
                        'inadequate': 'Limited or incorrect analysis; conclusions unsupported by data.',
                        'meets': 'Correct analysis of results with generally appropriate interpretation.',
                        'name': 'Data Analysis and Interpretation'},
                       {'exceeds': 'Excellent methodological rigor and precise application of techniques and '
                                   'tools.',
                        'inadequate': 'Significant methodological weaknesses or technical errors.',
                        'meets': 'Appropriate use of methods, tools, and scientific conventions.',
                        'name': 'Scientific Methodology and Technical Accuracy'},
                       {'exceeds': 'Critical evaluation of results, uncertainties, limitations, and '
                                   'opportunities for improvement.',
                        'inadequate': 'Limited discussion of results, errors, or limitations.',
                        'meets': 'Adequate discussion of findings and identification of key limitations.',
                        'name': 'Discussion and Critical Evaluation'},
                       {'exceeds': 'Report is professionally presented, logically structured, and '
                                   'demonstrates excellent scientific writing.',
                        'inadequate': 'Report lacks organization; numerous formatting or language errors.',
                        'meets': 'Report is well-structured and communicates findings clearly.',
                        'name': 'Structure, Presentation, and Scientific Communication'}],
 'Project': [{'exceeds': 'Demonstrates comprehensive and accurate understanding of the subject, integrating '
                         'concepts and methods effectively.',
              'inadequate': 'Demonstrates limited understanding of the subject; significant conceptual '
                            'errors or omissions.',
              'meets': 'Demonstrates satisfactory understanding of the relevant concepts, theories, and '
                       'methods; minor inaccuracies may be present.',
              'name': 'Understanding of the subject'},
             {'exceeds': 'Demonstrates a rigorous, well-justified, and innovative methodology adapted to the '
                         'complexity of the project.',
              'inadequate': 'Approach lacks rigor, coherence, or justification; methodology is inappropriate '
                            'or incomplete.',
              'meets': 'Applies an appropriate methodology and follows a logical approach to address the '
                       'problem or project objectives.',
              'name': 'Methodology and Problem-Solving Approach'},
             {'exceeds': 'Results are analyzed critically and insightfully; conclusions are robust, '
                         'well-supported, and demonstrate high-level reasoning.',
              'inadequate': 'Results are incomplete, weakly supported, or insufficiently analyzed.',
              'meets': 'Results are correctly analyzed and interpreted, with conclusions supported by '
                       'evidence.',
              'name': 'Analysis, Critical Thinking, and Quality of Results'},
             {'exceeds': 'Demonstrates outstanding initiative, autonomy, leadership, and effective '
                         'management of project activities and collaboration.',
              'inadequate': 'Limited autonomy, poor organization, or insufficient contribution to team '
                            'activities.',
              'meets': 'Demonstrates adequate planning, organization, autonomy, and effective participation '
                       'within the team.',
              'name': 'Project Management, Autonomy, and Teamwork'},
             {'exceeds': 'Communication is exceptionally clear, professional, persuasive, and adapted to the '
                         'intended a',
              'inadequate': 'Report and/or presentation lacks structure, clarity, or professionalism.',
              'meets': 'Project outcomes are communicated clearly and appropriately through written and/or '
                       'oral formats.',
              'name': 'Communication and Presentation of the Project'}],
 'Written test / examination': [{'exceeds': 'Demonstrates comprehensive and accurate understanding of '
                                            'concepts, theories, and methods.',
                                 'inadequate': 'Significant gaps in knowledge; major misconceptions; limited '
                                               'understanding of key concepts.',
                                 'meets': 'Demonstrates satisfactory understanding of most concepts and '
                                          'principles; minor inaccuracies may be present.',
                                 'name': 'Knowledge and Understanding of Course Content'},
                                {'exceeds': 'Applies knowledge accurately and effectively to complex, '
                                            'unfamiliar, or multidisciplinary problems.',
                                 'inadequate': 'Unable to correctly apply knowledge to solve problems or '
                                               'answer questions.',
                                 'meets': 'Correctly applies relevant knowledge and methods to standard '
                                          'problems and situations.',
                                 'name': 'Application and Problem-Solving'},
                                {'exceeds': 'Demonstrates rigorous, insightful, and critical analysis with '
                                            'well-justified conclusions.',
                                 'inadequate': 'Reasoning is unclear, incomplete, or unsupported.',
                                 'meets': 'Demonstrates logical reasoning and appropriate analysis of '
                                          'information.',
                                 'name': 'Analytical Reasoning and Critical Thinking'},
                                {'exceeds': 'Accurate and rigorous methodology throughout with no '
                                            'significant errors.',
                                 'inadequate': 'Frequent methodological or computational errors.',
                                 'meets': 'Appropriate methodology used with only minor errors.',
                                 'name': 'Methodological Rigor and Calculations (where applicable)'},
                                {'exceeds': 'Answers are exceptionally clear, coherent, concise, and '
                                            'professionally presented.',
                                 'inadequate': 'Answers are poorly structured, unclear, or difficult to '
                                               'follow.',
                                 'meets': 'Answers are generally clear, organized, and understandable.',
                                 'name': 'Communication and Presentation of Answers'}]}

ASSESSMENT_TYPES = ("Quiz", "Oral presentation", "Report", "Other")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _row(  # noqa: PLR0913 - one row of the catalogue table, spelled out
    item_id: str, category: str, label: str, payload: dict, sort_order: int, parent_id=None
) -> dict:
    stamp = _now()
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
        "created_at": stamp,
        "updated_at": stamp,
    }


def upgrade() -> None:
    connection = op.get_bind()
    catalogue = sa.table(
        "syllabus_catalogue_items",
        sa.column("payload", postgresql.JSONB),
        *(
            sa.column(name)
            for name in (
                "id", "category", "parent_id", "label", "sort_order",
                "is_retired", "retired_at", "revision", "created_at", "updated_at",
            )
        ),
    )

    existing = {
        row[0]
        for row in connection.execute(
            sa.text("SELECT id FROM syllabus_catalogue_items")
        )
    }
    rows = []

    for number, name in GRADUATE_COMPETENCIES.items():
        item_id = f"graduate-competency-{number}"
        if item_id not in existing:
            rows.append(
                _row(
                    item_id,
                    "graduate-competencies",
                    f"GradComp {number} — {name}",
                    {"code": f"GradComp {number}", "outcome": name},
                    number,
                )
            )

    for index, entry in enumerate(SCEN_COMPETENCIES, start=1):
        item_id = f"scen-competency-{index}"
        graduate_ids = [f"graduate-competency-{number}" for number in entry["graduate"]]
        current = connection.execute(
            sa.text("SELECT payload FROM syllabus_catalogue_items WHERE id = :id"), {"id": item_id}
        ).scalar()
        if current is None:
            rows.append(
                _row(
                    item_id,
                    "competencies",
                    f"{entry['code']} {entry['name']}",
                    {"code": entry["code"], "outcome": entry["description"], "graduateCompetencyIds": graduate_ids},
                    index,
                )
            )
            continue
        payload = json.loads(current) if isinstance(current, str) else dict(current)
        # Only fill what is still blank: a coordinator may have edited these already.
        payload.setdefault("code", entry["code"])
        if not payload.get("outcome"):
            payload["outcome"] = entry["description"]
        if not payload.get("graduateCompetencyIds"):
            payload["graduateCompetencyIds"] = graduate_ids
        connection.execute(
            sa.text(
                "UPDATE syllabus_catalogue_items SET payload = CAST(:payload AS jsonb), updated_at = :stamp,"
                " revision = revision + 1 WHERE id = :id"
            ),
            {"payload": json.dumps(payload), "stamp": _now(), "id": item_id},
        )

    # Matched on the preset's own label: the seeded ids are not in this dict's order.
    for label, criteria in RUBRICS.items():
        preset = connection.execute(
            sa.text(
                "SELECT id, payload FROM syllabus_catalogue_items"
                " WHERE category = 'rubric-presets' AND lower(label) = lower(:label)"
            ),
            {"label": label},
        ).first()
        if preset is None:
            continue
        preset_id, current = preset
        payload = json.loads(current) if isinstance(current, str) else dict(current)
        if payload.get("criteria"):
            continue  # already filled in by hand
        payload["criteria"] = criteria
        connection.execute(
            sa.text(
                "UPDATE syllabus_catalogue_items SET payload = CAST(:payload AS jsonb), updated_at = :stamp,"
                " revision = revision + 1 WHERE id = :id"
            ),
            {"payload": json.dumps(payload), "stamp": _now(), "id": preset_id},
        )

    for offset, label in enumerate(ASSESSMENT_TYPES):
        index = len(RUBRICS) + 1 + offset
        assessment_id = f"assessment-type-{index}"
        if assessment_id in existing:
            continue
        rows.append(_row(assessment_id, "assessment-types", label, {}, index))
        rows.append(
            _row(
                f"rubric-preset-{index}",
                "rubric-presets",
                label,
                {"assessmentTypeId": assessment_id, "criteria": []},
                index,
            )
        )

    if rows:
        op.bulk_insert(catalogue, rows)


def downgrade() -> None:
    op.execute("DELETE FROM syllabus_catalogue_items WHERE category = 'graduate-competencies'")
    op.execute(
        "DELETE FROM syllabus_catalogue_items WHERE id IN ("
        "'assessment-type-4','assessment-type-5','assessment-type-6','assessment-type-7',"
        "'rubric-preset-4','rubric-preset-5','rubric-preset-6','rubric-preset-7')"
    )
