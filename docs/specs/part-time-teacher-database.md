# Part-time Teacher Database

The teacher database replaces the legacy teaching-requisition library. It stores durable, archiveable part-time teacher profiles with an opaque generated ID, optional email/phone, notes, and nested teacher folders.

Requisitions are labelled, revisioned records attached to a teacher. Multiple records may share an academic year. The DOCX export fills the employee name from the parent teacher profile while retaining the existing academic request fields and teaching-load editor.

The `0007` migration intentionally removes legacy requisition and requisition-folder data before creating the empty teacher database schema. Archived teachers are hidden from the default library but can be restored from the Archived view.

## Google Form document intake

The optional document workflow is a controlled Google Drive integration, not a SharePoint integration. A named staff member signs in with Google to manually run **Sync form responses** from the teacher library. The backend reads the linked Google Form response sheet, groups responses by the required email field, and processes only the latest timestamped response for each email.

- A response updates a profile only when its email matches exactly one active teacher profile (case-insensitive). No profile is created automatically.
- Each accepted response is copied into a fresh managed Google Drive folder for the teacher. The profile points to that current folder, and the prior managed folder is trashed only after the copy succeeds. This means the current folder contains only the latest response’s files while the original Google Form uploads remain unchanged.
- Zero matches, duplicate active-profile matches, and copy failures become visible in the protected review queue. Sync can be run again after the data is corrected.
- The profile exposes a link to the managed folder and a server-generated ZIP download for emailing HR. Download is capped at 100 files and 100 MiB by default.
- The workflow is independently authenticated. A Google ID token is checked by the backend and its verified email must be in `GOOGLE_DOCUMENTS_ACCESS_EMAILS`. At sync time, the browser obtains a short-lived Drive/Sheets token; the backend confirms that its Google account is the same as the verified ID-token email before using it. No document token is persisted in browser storage or the database. The configured allowlist receives reader access to each generated folder.

The integration stays disabled until deployment configuration supplies the service-account JSON, response-sheet ID/range and headers, Drive root folder ID, OAuth web-client ID, and staff allowlist. The coordinator who runs sync must own or edit the managed Drive root and authorize the temporary Drive/Sheets scopes. The service account only needs inherited read access to that root for server-generated ZIP downloads; it should not receive broad university Drive access.
