# Part-time Teacher Database

The teacher database replaces the legacy teaching-requisition library. It stores durable, archiveable part-time teacher profiles with an opaque generated ID, optional email/phone, notes, and nested teacher folders.

Requisitions are labelled, revisioned records attached to a teacher. Multiple records may share an academic year. The DOCX export fills the employee name from the parent teacher profile while retaining the existing academic request fields and teaching-load editor.

## Shared field information and tasks

Field information is a record-specific, shared capability. A coordinator clicks a saved field label to reveal the information control, then can add or edit guidance for that exact resource and stable field key. Field information is deliberately separate from syllabus edit history: it is enabled for saved syllabus, teacher-profile, and teacher-requisition fields, while unsaved creation forms do not expose it.

Tasks are generic scoped records, reusable by future apps but currently shown only on teacher profiles and in the teacher library. A task has a title, an optional description, an optional due date, and a binary status of `NOT_STARTED` or `COMPLETED`. Status changes are revision-protected and preserve the completion timestamp until the task is reopened; tasks are retained when a teacher is archived.

Migration `0020` retired the `IN_PROGRESS` stage, converting those rows to `NOT_STARTED` and leaving completed rows and their timestamps untouched. The API still accepts `IN_PROGRESS` for one release and folds it into `NOT_STARTED`, so a browser holding an older bundle cannot fail a save.

Each task carries an activity history of dated `CREATED`, `COMPLETED`, and `REOPENED` entries, read from `GET /api/v1/tasks/{id}/activity`. Only completion and reopening are stored; the creation entry is derived from the task's `created_at`, so every creation path reports a full history — including the onboarding bundles written by `TeacherStore`, which does not write activity rows. Actor attribution is deliberately deferred.

Two kinds of template exist and are not interchangeable. A **bundle** (`task_templates` + `task_template_items`) applies several tasks at once; the fixed **Teacher onboarding** bundle still creates CID Clearance, Requisition signature, and ID Issuance (for newcomers) when a teacher is created. A **quick template** (`task_quick_templates`) is a single reusable title and description that pre-fills the task form; coordinators create, edit, and delete them from the task dialog, and they are shared across all coordinators per resource type.

The teacher library also provides a teacher-only **Tasks Overview**: summary cards for total, open, completed, and overdue work over the current scope, primary status and teacher filters, and secondary search, folder, and deadline filters. It defaults to open tasks for active teachers, ordered overdue, due within seven days, then undated. Teacher rows show completed/total task progress and an urgency warning when applicable. This is not a platform-wide inbox. Assignees, notifications, comments, recurring tasks, and named activity actors are out of scope.

Each teaching-load course has its own required class type (CM, TD, TP, Coach, or Not Applicable). The requisition-level type of class remains for the approved form. Course-row DOCX hours render as numeric hours followed by the course class type (for example `15 TD`); legacy suffixed hour values remain readable and export unchanged.

The `0007` migration intentionally removes legacy requisition and requisition-folder data before creating the empty teacher database schema. Archived teachers are hidden from the default library but can be restored from the Archived view.

## Google Form document intake

The optional document workflow is a controlled Google Drive integration, not a SharePoint integration. A named staff member signs in with Google to manually run **Sync form responses** from the teacher library. The backend reads the linked Google Form response sheet, groups responses by the required email field, and processes only the latest timestamped response for each email.

- A response updates a profile only when its email matches exactly one active teacher profile (case-insensitive). No profile is created automatically.
- Each accepted response is copied into a fresh managed Google Drive folder for the teacher. The profile points to that current folder, and the prior managed folder is trashed only after the copy succeeds. This means the current folder contains only the latest response’s files while the original Google Form uploads remain unchanged.
- Zero matches, duplicate active-profile matches, and copy failures become visible in the protected review queue. Sync can be run again after the data is corrected.
- The profile exposes a link to the managed folder and a server-generated ZIP download for emailing HR. Download is capped at 100 files and 100 MiB by default.
- The workflow is independently authenticated. A Google ID token is checked by the backend and its verified email must be in `GOOGLE_DOCUMENTS_ACCESS_EMAILS`. At sync time, the browser obtains a short-lived Drive/Sheets token; the backend confirms that its Google account is the same as the verified ID-token email before using it. No document token is persisted in browser storage or the database. The configured allowlist receives reader access to each generated folder.

The integration stays disabled until deployment configuration supplies the service-account JSON, response-sheet ID/range and headers, Drive root folder ID, OAuth web-client ID, and staff allowlist. The coordinator who runs sync must own or edit the managed Drive root and authorize the temporary Drive/Sheets scopes. The service account only needs inherited read access to that root for server-generated ZIP downloads; it should not receive broad university Drive access.
