# Claude Code entrypoint

Read [AGENTS.md](AGENTS.md) in full before inspecting or changing the project. It is the durable project memory and working agreement for this repository.

Then load only the task-specific material it names, especially:

- [UI/UX handoff](docs/handoffs/ui-ux-decisions.md) for interface work.
- [Template-aware syllabi ADR](docs/decisions/ADR-001-template-aware-syllabi.md) for syllabus/template work.
- Relevant files under `docs/specs/` or `docs/plans/` for teacher-database work.

Production syllabi are actively used. Prefer additive, backward-compatible changes; never alter or discard stored syllabus content, folders, history, template associations, comparisons, or exports without an approved migration plan. Keep secrets in ignored environment files or FastAPI Cloud—never source control.
