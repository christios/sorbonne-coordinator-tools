# Claude Code entrypoint — Sorbonne Coordinator Tools

Read [AGENTS.md](AGENTS.md) in full before inspecting or changing the project. It is the durable project memory, including the current product map, authentication rules, production-data safeguards, and working agreement.

Then load only the task-specific material it names:

- [UI/UX handoff](docs/handoffs/ui-ux-decisions.md) for interface work.
- [Template-aware syllabi ADR](docs/decisions/ADR-001-template-aware-syllabi.md) for syllabus/template work.
- [Part-time Teacher Database spec](docs/specs/part-time-teacher-database.md) for teacher, requisition, task, and field-information work.
- The matching document under `docs/specs/` or `docs/plans/` for any other feature.

Before editing, inspect `git status` and the relevant source and tests. The workspace may contain unrelated user-owned outputs; preserve them. Production syllabus and teacher data are live: prefer additive, backward-compatible changes, never place secrets in source control, and use the shared authenticated frontend request helper for every internal API call.
