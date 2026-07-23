# Courses & CRNs in Banner

Creating and maintaining the course catalogue and its sections in Banner. This is
prerequisite plumbing for timetables, grade entry, and student communication.

!!! abstract "Two screens, two things"
    - **`SCACRSE`** — create a **course** (the catalogue entry: subject + course
      code + CM/TD hours).
    - **`SSASECT`** — create a **section (CRN)** — a specific offering of a course
      in a term.

    **Creating CRNs happens on Banner. Assigning professors to courses happens on
    Portal** (*Faculty Services → Monitoring Courses*).

## Creating a course (`SCACRSE`)

Create the course entry with its subject code, course number, and the hours by
type (CM / TD / TP).

## Creating a section / CRN (`SSASECT`)

- **`Section`** → the number of groups. (Sometimes the field doesn't accept the
  value on the first try; per Registrar guidance it isn't really consequential —
  just keep incrementing until it takes.)
- **`Part of term`** → **Full term** (the term is generated automatically).
- The **CRN is generated at the top of the page** — copy it and use it.

### Deleting an old CRN before creating a new one

Delete the old CRN from `SSASECT` **before** creating the new one **only if you no
longer need it**. You no longer need it when:

- the **course name has changed**, or
- you're **closing a group** and won't need that CRN anymore (each CRN costs the
  institution money, so don't leave dead ones lying around).

If the course is unchanged, **keep the same CRN**.

## Rolling courses between years

- When courses are **rolled**, the sections from one year/semester appear in the
  next (e.g. `252620` = 25-26 S2 rolls into `262720` = 26-27 S2).
- Rolled sections keep the **same CRN if the maquette is unchanged**. If the
  **maquette changed**, the rolled sections will have **wrong CRNs** and must be
  recreated.
- **Amina (Registrar) notifies you when courses have been rolled.**

!!! warning "Maquette changes ripple"
    A maquette change (new/renamed courses) means: recreate CRNs, and be careful
    that lists of repeating students use the **coming** semester's CRN, not the
    current one. For 26-27, note that **all of the L2 maquette is new**, and new
    Master programmes (MIAI) are being created.

## Parent CRNs

**Parent CRNs** group/relate sections. They're maintained in a dedicated extract
(the `CRN-List` workbook in the SCEN *Parent CRNs* archive folder), generated from
the timetable workbook's per-programme sheets (FYS-S1, BSc-L1-S1, BSc-L2-S3,
BSc-L3-S5, and the MSc/MIAI sheet). Parent CRNs are also a candidate mechanism for
**bulk student communication** (reaching a whole population via Banner) — see
[Known issues](../reference/known-issues.md).

## Course-name consistency

Keep the **course-name format consistent** in Banner. Inconsistent naming makes
CRN lists, timetables, and cross-checks harder and is an ongoing clean-up item.

## Who owns what

- **Course codes / maquette in Apogée** are normally prepared by the **Academic
  Coordinator** and maintained with the **HoD**.
- The **Registrar** creates the **major/programme** in the system once all
  approvals and information are received.
- **HR** does the Banner data entry for **full-time and part-time staff**.
