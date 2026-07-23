# Systems & platforms

The systems a SCEN coordinator touches, what each is **for**, and — importantly —
which ones you **input into** versus only **read from**.

!!! abstract "The one-line mental model"
    **Banner** is the source of truth for courses, sections (CRNs) and FYS grades.
    **Portal** reads from Banner and is where Admissions maintains student data and
    where you assign professors to courses. **Blackboard** is teaching &
    assessment. **Paris (Apogée)** validates and issues Bachelor grades.
    Everything else is HR, IT, or facilities plumbing around those.

## Academic systems

### Banner (Student Information System)

Ellucian Banner is the staff-facing SIS. For SCEN you use it mainly to:

- **Create courses** — screen `SCACRSE`.
- **Create sections (CRNs)** — screen `SSASECT`. A CRN is a specific offered
  section of a course in a term.
- **Enter / change FYS grades** — screen `SHATCKN` (FYS only).

Banner is also the hub that feeds:

- **Serco** (facilities / timetabling),
- **Admissions** (student records),
- **HEDB** (the government reporting interface — it reads student/programme data
  from Banner).

For full-time and part-time staff, **HR does the data entry** in Banner.

See the procedure: [Courses & CRNs in Banner](../procedures/courses-crns.md).

### Portal (Registrar Portal)

- **You do not input student data into Portal.** Portal *reflects* what is in
  Banner; Admissions inputs the student-related information (names, IDs, diplomas,
  passports, visas).
- You **read** student lists from Portal (see
  [Student lists](../procedures/student-lists.md)).
- You **assign professors to courses** here: *Faculty Services → Monitoring
  Courses → select the semester → assign with `+`*.

### Blackboard (= Moodle)

The teaching and assessment platform. Holds course **materials, assessments,
solutions, and tests**, and is where **exams (including catch-up exams) are
delivered and submitted**.

- Accreditation reviewers (CAA) check course content on Blackboard, so it matters
  that it's complete.
- **Anonymous grading caveat:** while anonymous grading is enabled on a Blackboard
  exam, only the *number* of submissions is visible — not *which* students
  submitted. The accurate submitter list is only available once grading is
  complete and anonymity is lifted. This affects catch-up attendance lists.

### SRS / Argos

Reporting/extract tooling used to **download FYS transcripts**. Path:
*Registrar Office → "2026 Student Academic Report (Final Grade) — Sciences and
Engineering with Jury decision"*.

Access is granted by IT (e.g. Junaid). SRS is also where you print an individual
transcript after changing a grade in Banner.

### SIMAS

Registrar system used to **create Banner IDs for new Visiting Professors and
Local/Flying PROA**. Entry point: the registrar app at
`simasappsrv.psuad.ac.ae/registrar/`. See
[Staffing & contracts](../procedures/staffing-contracts.md).

### VP Onboarding app

The workflow app for onboarding Visiting Professors. You enter the VP's **Banner
ID**, and their scheduling info is pulled from Banner. It then issues a link
(automatically, after submission) that the VP uses to upload their own
information and documents, which feeds the **CID clearance** process.

## Sorbonne Paris systems

### Apogée

The Paris-side grade/records system. For L1–L3, **Paris** enters and validates
grades in Apogée and issues the official **PVs and transcripts**. Admissions may
need Apogée access from Paris to pull L1 student information.

!!! warning "Partnership in transition"
    The Bachelor grade workflow described in this handbook runs through
    **Université Paris Cité**. SUAD has announced that this academic-programme
    partnership is **concluding**, with **Université Paris-Panthéon-Assas (Paris
    II)** arriving as a new partner. Expect the Paris-side contacts, systems, and
    grade routing for future cohorts to change. Verify before relying on any
    Paris-specific step.

## HR / ERP / IT service systems

| System | What it's for |
|---|---|
| **ADERP** (Oracle Fusion) | HR self-service: onboarding journey, leave/remote-work requests, **Education Allowance** (submit Jul–Oct), dependents, personal info. |
| **Oracle EBS** | ERP modules used by Finance/HR (requisitions, PRs, GL). |
| **ServiceHub** (`esm.gov.ae/servicehub`) | Log IT tickets and request stationery / report IT issues. Needs MFA. |
| **Adobe Acrobat Sign** | E-signature for contracts and some forms. |
| **Teams** | Departmental file sharing, grade files from Paris, timetable collaboration, pastoral care. |

**IT Helpdesk:** 02 656 9123 · ServiceHub (IT Helpdesk icon) · Office 2.157.

!!! note "Planned outages"
    IT periodically announces maintenance windows that take **Banner, Portal,
    Argos, SIMAS, print services, and Oracle EBS** offline (often Friday nights).
    Watch the *Sorbonne IT Announcement* emails and don't schedule a grade upload
    into an outage window.
