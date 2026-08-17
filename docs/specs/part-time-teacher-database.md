# Part-time Teacher Database

The teacher database replaces the legacy teaching-requisition library. It stores durable, archiveable part-time teacher profiles with an opaque generated ID, optional email/phone, notes, and nested teacher folders.

Requisitions are labelled, revisioned records attached to a teacher. Multiple records may share an academic year. The DOCX export fills the employee name from the parent teacher profile while retaining the existing academic request fields and teaching-load editor.

The `0007` migration intentionally removes legacy requisition and requisition-folder data before creating the empty teacher database schema. Archived teachers are hidden from the default library but can be restored from the Archived view.
