import { AddEntryButton } from "@/components/AddEntryButton";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";

import { FieldHistoryControl, HistoryField } from "@/components/FieldHistory";
import { HistoryTextField } from "@/components/HistoryTextField";
import { SelectMenu } from "@/components/SelectMenu";
import { SyllabusSubsection } from "@/components/SyllabusSubsection";
import { TimeField } from "@/components/TimeField";
import { CatalogueEntry } from "@/services/syllabusCatalogues";

type HistoryContext = { syllabusId: string; revision: number; onOpenHistory: (field: HistoryField) => void };
type Props = HistoryContext & { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void };
type Affiliation = { id: string; name: string };
type OfficeHour = { id: string; day?: string; startTime?: string; endTime?: string; location?: string; legacyText?: string };

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function AcademicContactsEditor({ value, onChange, people = [], ...history }: Props & { people?: CatalogueEntry[] }) {
  const instructor = record(value.instructor);
  const administrativeContact = typeof value.administrativeContact === "string" ? { contactDetails: value.administrativeContact } : record(value.administrativeContact);
  const updateInstructor = (next: Record<string, unknown>) => onChange({ ...value, instructor: next });
  const field = (label: string, fieldPath: string) => ({ path: fieldPath, label });
  const instructorPerson = people.find((person) => person.id === stringValue(instructor.personId));
  const coordinatorPerson = people.find((person) => person.id === stringValue(administrativeContact.personId));
  const instructorOptions = people.filter((person) => Array.isArray(person.payload.roles) && person.payload.roles.includes("instructor")).map((person) => ({ value: person.id, label: person.label }));
  const coordinatorOptions = people.filter((person) => Array.isArray(person.payload.roles) && person.payload.roles.includes("coordinator")).map((person) => ({ value: person.id, label: person.label }));

  return <div className="grid gap-4"><SyllabusSubsection title="Course instructor">{people.length ? <label className="grid gap-1 text-sm font-medium text-[#344054]"><span>Instructor from People directory <span className="font-normal text-[#667085]">(optional)</span></span><SelectMenu label="Instructor from People directory" value={stringValue(instructor.personId)} onChange={(personId) => updateInstructor({ ...instructor, personId: personId || undefined })} placeholder="Enter contact details manually" searchable options={[{ value: "", label: "Enter contact details manually" }, ...instructorOptions]} /></label> : null}{instructorPerson ? <LivePersonCard person={instructorPerson} /> : <><ContactField label="Name" value={stringValue(instructor.Name)} onChange={(Name) => updateInstructor({ ...instructor, Name })} field={field("Name", "contacts.instructor.Name")} {...history} /><ContactField label="Academic rank / status" value={stringValue(instructor["Academic rank / status"])} onChange={(rank) => updateInstructor({ ...instructor, "Academic rank / status": rank })} field={field("Academic rank / status", "contacts.instructor.Academic rank / status")} {...history} /><AffiliationsEditor instructor={instructor} onChange={updateInstructor} {...history} /><OfficeHoursEditor instructor={instructor} onChange={updateInstructor} {...history} /><ContactField label="Email" value={stringValue(instructor.Email)} onChange={(Email) => updateInstructor({ ...instructor, Email })} field={field("Email", "contacts.instructor.Email")} {...history} /></>}</SyllabusSubsection><SyllabusSubsection title="Academic coordinator">{people.length ? <label className="grid gap-1 text-sm font-medium text-[#344054]"><span>Academic coordinator from People directory <span className="font-normal text-[#667085]">(optional)</span></span><SelectMenu label="Academic coordinator from People directory" value={stringValue(administrativeContact.personId)} onChange={(personId) => onChange({ ...value, administrativeContact: { ...administrativeContact, personId: personId || undefined } })} placeholder="Enter coordinator details manually" searchable options={[{ value: "", label: "Enter coordinator details manually" }, ...coordinatorOptions]} /></label> : null}{coordinatorPerson ? <LivePersonCard person={coordinatorPerson} /> : <><ContactField label="Academic coordinator name" value={stringValue(administrativeContact.name)} onChange={(name) => onChange({ ...value, administrativeContact: { ...administrativeContact, name } })} field={field("Academic coordinator name", "contacts.administrativeContact.name")} {...history} /><ContactField label="Academic coordinator contact details" value={stringValue(administrativeContact.contactDetails)} onChange={(contactDetails) => onChange({ ...value, administrativeContact: { ...administrativeContact, contactDetails } })} multiline field={field("Academic coordinator contact details", "contacts.administrativeContact.contactDetails")} {...history} /></>}</SyllabusSubsection></div>;
}

function LivePersonCard({ person }: { person: CatalogueEntry }) { const payload = person.payload; return <div className="rounded-md border border-[#d9dee7] bg-[#f8fafc] p-4 text-sm text-[#475467]"><p className="font-semibold text-[#344054]">{person.label}</p><p className="mt-1">{[stringValue(payload.academicRank), stringValue(payload.affiliations), stringValue(payload.officeHours), stringValue(payload.email)].filter(Boolean).join(" · ") || "Directory details will appear here."}</p><p className="mt-2 text-xs text-[#667085]">Live directory details are read-only in the syllabus. Update them in Manage catalogues.</p></div>; }

function AffiliationsEditor({ instructor, onChange, ...history }: HistoryContext & { instructor: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const affiliations = affiliationEntries(instructor);
  const save = (next: Affiliation[]) => onChange({ ...instructor, affiliations: next, "Affiliation(s)": next.map((item) => item.name).filter(Boolean).join("\n") });
  return <section><h4 className="text-sm font-semibold text-[#344054]">Affiliations</h4>{affiliations.length ? <div className="mt-3 grid gap-3">{affiliations.map((item, index) => <div key={item.id} className="flex items-end gap-2"><div className="min-w-0 flex-1"><ContactField label={`Affiliation ${index + 1}`} value={item.name} onChange={(name) => save(affiliations.map((entry) => entry.id === item.id ? { ...entry, name } : entry))} field={{ path: `contacts.instructor.affiliations[${item.id}].name`, label: `Affiliation ${index + 1}` }} {...history} /></div><button type="button" onClick={() => save(affiliations.filter((entry) => entry.id !== item.id))} className="mb-0.5 rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove affiliation ${index + 1}`}><X size={17} /></button></div>)}</div> : null}<AddEntryButton onClick={() => save([...affiliations, { id: crypto.randomUUID(), name: "" }])} label="Add affiliation" /></section>;
}

function OfficeHoursEditor({ instructor, onChange, ...history }: HistoryContext & { instructor: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const entries = officeHourEntries(instructor);
  const save = (next: OfficeHour[]) => onChange({ ...instructor, officeHours: next, "Office hours and location": next.map(officeHourSummary).filter(Boolean).join("\n") });
  return <section><h4 className="text-sm font-semibold text-[#344054]">Office hours and location</h4>{entries.length ? <div className="mt-3 grid gap-3">{entries.map((entry, index) => <OfficeHourCard key={entry.id} entry={entry} index={index} onChange={(next) => save(entries.map((item) => item.id === entry.id ? next : item))} onRemove={() => save(entries.filter((item) => item.id !== entry.id))} {...history} />)}</div> : null}<AddEntryButton onClick={() => save([...entries, { id: crypto.randomUUID() }])} label="Add office hour" /></section>;
}

function OfficeHourCard({ entry, index, onChange, onRemove, ...history }: HistoryContext & { entry: OfficeHour; index: number; onChange: (value: OfficeHour) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(Boolean(entry.legacyText) || !officeHourSummary(entry));
  const path = `contacts.instructor.officeHours[${entry.id}]`;
  const update = (change: Partial<OfficeHour>) => onChange({ ...entry, ...change });
  return <article className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd]"><div className="flex items-start gap-3 p-3"><button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-start gap-2 text-left"><ChevronDown size={17} className={`mt-0.5 shrink-0 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} /><span className="min-w-0"><span className="block text-sm font-semibold text-[#344054]">Office hour {index + 1}</span><span className="mt-0.5 block text-sm text-[#475467]">{officeHourSummary(entry) || "Untitled office hour"}</span></span></button><button type="button" onClick={onRemove} className="rounded p-1 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove office hour ${index + 1}`}><X size={17} /></button></div>{open ? <div className="grid gap-4 border-t border-[#e5e7eb] p-4">{entry.legacyText !== undefined ? <ContactField label="Imported office-hours details" value={entry.legacyText} onChange={(legacyText) => update({ legacyText })} multiline field={{ path: `${path}.legacyText`, label: `Office hour ${index + 1} · Imported details` }} {...history} /> : <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1 text-sm font-medium text-[#344054]">Day<SelectMenu label={`Office hour ${index + 1} day`} value={entry.day ?? ""} onChange={(day) => update({ day })} placeholder="Select day" options={days.map((day) => ({ value: day, label: day }))} trailing={<FieldHistoryControl syllabusId={history.syllabusId} revision={history.revision} field={{ path: `${path}.day`, label: `Office hour ${index + 1} · Day` }} onOpenSidebar={history.onOpenHistory} />} /></label><ContactField label="Location" value={entry.location ?? ""} onChange={(location) => update({ location })} field={{ path: `${path}.location`, label: `Office hour ${index + 1} · Location` }} {...history} /><ContactField label="Start time" value={entry.startTime ?? ""} onChange={(startTime) => update({ startTime })} type="time" field={{ path: `${path}.startTime`, label: `Office hour ${index + 1} · Start time` }} {...history} /><ContactField label="End time" value={entry.endTime ?? ""} onChange={(endTime) => update({ endTime })} type="time" field={{ path: `${path}.endTime`, label: `Office hour ${index + 1} · End time` }} {...history} /></div>}</div> : null}</article>;
}

function ContactField({ label, value, onChange, field, syllabusId, revision, onOpenHistory, multiline = false, type = "text" }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField; multiline?: boolean; type?: string }) {
  const history = <FieldHistoryControl syllabusId={syllabusId} revision={revision} field={field} onOpenSidebar={onOpenHistory} placement={multiline ? "top" : "center"} />;
  if (type === "time") return <TimeField label={label} value={value} onChange={onChange} trailing={history} />;
  return <HistoryTextField label={label} value={value} onChange={onChange} multiline={multiline} minRows={3} type={type} history={{ field, onOpenHistory }} />;
}

function affiliationEntries(instructor: Record<string, unknown>): Affiliation[] {
  if (Array.isArray(instructor.affiliations)) return instructor.affiliations.flatMap((item, index) => item && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string" ? [{ id: typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, string>).id : `legacy-affiliation-${index}`, name: (item as Record<string, string>).name }] : []);
  const legacy = stringValue(instructor["Affiliation(s)"]);
  return legacy.trim() ? [{ id: "legacy-affiliation-0", name: legacy }] : [];
}

function officeHourEntries(instructor: Record<string, unknown>): OfficeHour[] {
  if (Array.isArray(instructor.officeHours)) return instructor.officeHours.flatMap((item, index) => item && typeof item === "object" ? [{ ...(item as Omit<OfficeHour, "id">), id: typeof (item as Record<string, unknown>).id === "string" ? (item as OfficeHour).id : `legacy-office-hour-${index}` }] : []);
  const legacy = stringValue(instructor["Office hours and location"]);
  return legacy.trim() ? [{ id: "legacy-office-hour-0", legacyText: legacy }] : [];
}

function officeHourSummary(entry: OfficeHour) {
  if (entry.legacyText) return entry.legacyText;
  return [entry.day, entry.startTime && entry.endTime ? `${entry.startTime}–${entry.endTime}` : entry.startTime || entry.endTime, entry.location].filter(Boolean).join(" · ");
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
