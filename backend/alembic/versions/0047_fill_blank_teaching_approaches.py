"""Fill in any teaching approach the department has not written yet.

Only blank subsections are filled: a coordinator's own wording in the catalogue is
left exactly as it is. Text comes from "Syllabi platform - section 8- teaching methods".

Revision ID: 0047
Revises: 0046
Create Date: 2026-08-31
"""

from datetime import UTC, datetime
import json

from alembic import op
import sqlalchemy as sa


revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


TEACHING_PRESETS = {
    "Laboratory / TP": {
        "engagement": "Students must prepare by reviewing laboratory instructions, theoretical "
        "concepts, and safety procedures before each session. During laboratory "
        "work, students are expected to actively participate in experiments, data "
        "collection, analysis, and technical tasks while collaborating "
        "effectively with peers where applicable. Outside scheduled sessions, "
        "students may be required to complete laboratory reports, analyze "
        "results, and undertake additional research. Students should use "
        "instructor feedback on laboratory performance and reports to improve "
        "their methodological and technical competencies. Attendance is "
        "compulsory for laboratory sessions and is monitored through attendance "
        "records and completion of laboratory activities.",
        "feedback": "Feedback is provided continuously during laboratory activities through "
        "observation, technical guidance, discussion of experimental procedures, "
        "and review of laboratory results. Laboratory reports and practical "
        "assignments receive written and/or oral feedback focusing on technical "
        "accuracy, data analysis, interpretation of results, and scientific "
        "methodology. Students are expected to use this feedback to improve both "
        "their practical skills and their ability to communicate scientific "
        "findings.",
        "methods": "Hands-on practical activities allowing students to apply theoretical "
        "knowledge through experiments, technical exercises, simulations, "
        "programming tasks, or the use of specialized equipment and software, and to "
        "report in writing. TPs develop methodological, technical, and data-analysis "
        "skills.",
    },
    "Lectures / Cours magistraux": {
        "engagement": "Students are expected to prepare for lectures by completing "
        "assigned readings and reviewing supporting materials when "
        "provided. During class, they should actively engage with the "
        "content by taking notes, asking questions, and participating "
        "in discussions where appropriate. Outside class, students "
        "are expected to consolidate their understanding through "
        "independent study, review of lecture materials, and "
        "completion of assigned exercises. Students should use "
        "instructor feedback to identify areas requiring additional "
        "effort and seek clarification when needed. Attendance is "
        "recorded at each lecture session in accordance with the "
        "programme attendance policy.",
        "feedback": "Feedback is provided through in-class questioning, "
        "discussions, formative quizzes where applicable, and "
        "clarification of common misconceptions identified during "
        "lectures. Students are encouraged to use this feedback to "
        "monitor their understanding of core concepts and identify "
        "areas requiring further study. Additional feedback may be "
        "provided during office hours or individual consultations.",
        "methods": "Instructor-led sessions designed to introduce and explain key "
        "concepts, theories, methods, and disciplinary frameworks. "
        "Lectures provide the foundational knowledge required for "
        "subsequent tutorials, laboratory work, and independent study.",
    },
    "Problem-solving / TD": {
        "engagement": "Students are expected to arrive prepared, having reviewed the "
        "relevant lecture content and attempted assigned exercises. Active "
        "participation is essential and includes contributing to "
        "discussions, solving problems individually and collaboratively, "
        "explaining reasoning, and engaging constructively with peers. "
        "Independent work between sessions is expected to reinforce concepts "
        "and complete assigned activities. Students should actively reflect "
        "on feedback provided during exercises and discussions to improve "
        "their analytical and problem-solving skills. Attendance is "
        "monitored at each session and forms part of the expectations for "
        "successful completion of the course.",
        "feedback": "TD sessions provide frequent formative feedback through guided "
        "problem-solving activities, instructor comments, and collective "
        "correction of exercises. Students receive feedback on their "
        "analytical approach, reasoning, methodology, and communication of "
        "solutions. They are expected to reflect on this feedback, correct "
        "errors, and apply the recommendations in subsequent exercises and "
        "assessments. Individual guidance may be provided during or after "
        "sessions to support academic progress.",
        "methods": "Interactive small-group sessions in which students apply concepts "
        "introduced in lectures through exercises, case studies, guided "
        "problem-solving, discussions, and analytical activities. TDs reinforce "
        "understanding, develop critical thinking, and provide opportunities "
        "for feedback and clarification.",
    },
    "Project": {
        "engagement": "Students are expected to take primary responsibility for planning, organizing, "
        "and completing project tasks. This includes conducting independent research, "
        "managing deadlines, applying course concepts, and contributing actively to "
        "teamwork when projects are group-based. Regular collaboration with peers, "
        "participation in project meetings, and constructive engagement with supervision "
        "sessions are expected. Students should incorporate feedback received throughout "
        "the project lifecycle into subsequent stages of their work and demonstrate "
        "continuous improvement. Attendance at scheduled project supervision meetings, "
        "presentations, and milestone reviews is monitored in accordance with programme "
        "requirements.",
        "feedback": "Project feedback is delivered throughout the project lifecycle through supervision "
        "meetings, progress reviews, milestone evaluations, draft reviews, and "
        "presentations. Feedback focuses on project planning, methodological choices, "
        "technical implementation, teamwork, critical analysis, and communication. Students "
        "are expected to actively engage with feedback, demonstrate evidence of improvement "
        "between project stages, and incorporate recommendations into subsequent project "
        "deliverables. This iterative feedback process supports the development of "
        "independent learning, project management, and professional competencies.",
        "methods": "An individual or group-based learning activity in which students investigate a "
        "problem, design a solution, develop a product or study, and communicate their "
        "results. Projects encourage the integration of knowledge and skills while fostering "
        "autonomy, project management, teamwork, and professional communication "
        "competencies.",
    },
}


def upgrade() -> None:
    connection = op.get_bind()
    stamp = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    for label, sections in TEACHING_PRESETS.items():
        row = connection.execute(
            sa.text(
                "SELECT id, payload FROM syllabus_catalogue_items"
                " WHERE category = 'teaching-presets' AND lower(label) = lower(:label)"
            ),
            {"label": label},
        ).first()
        if row is None:
            continue
        preset_id, payload = row
        payload = json.loads(payload) if isinstance(payload, str) else dict(payload)
        changed = False
        for key, text in sections.items():
            if not str(payload.get(key) or "").strip():
                payload[key] = text
                changed = True
        if not changed:
            continue
        connection.execute(
            sa.text(
                "UPDATE syllabus_catalogue_items SET payload = CAST(:payload AS jsonb),"
                " updated_at = :stamp, revision = revision + 1 WHERE id = :id"
            ),
            {"payload": json.dumps(payload), "stamp": stamp, "id": preset_id},
        )


def downgrade() -> None:
    """The text is content, not schema: removing it would lose a coordinator's edits."""
