import { RosterRow } from "@/services/rosters";

type Props = {
  rows: RosterRow[];
};

export function RosterTable({ rows }: Props) {
  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white">
      <div className="flex items-center justify-between border-b border-[#edf0f4] px-5 py-4">
        <h2 className="text-base font-semibold text-[#171717]">Roster Preview</h2>
        <span className="rounded-md bg-[#eef1f5] px-2.5 py-1 text-xs font-medium text-[#424956]">
          {rows.length} rows
        </span>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-[980px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[#e8edf3] text-xs uppercase tracking-normal text-[#333943]">
            <tr>
              <Header>#</Header>
              <Header>ID</Header>
              <Header>Student Name</Header>
              <Header>Status</Header>
              <Header>Major</Header>
              <Header>Dept.</Header>
              <Header>Level</Header>
              <Header>#Hours of Absences</Header>
              <Header>Absence %</Header>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.number} className="border-t border-[#edf0f4]">
                <Cell>{row.number}</Cell>
                <Cell>{row.student_id}</Cell>
                <Cell className="font-medium text-[#171717]">{row.student_name}</Cell>
                <Cell>{row.status}</Cell>
                <Cell>{row.major}</Cell>
                <Cell>{row.department}</Cell>
                <Cell>{row.level}</Cell>
                <Cell>{row.hours_of_absences}</Cell>
                <Cell>{row.absence_percent}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Header({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-semibold">{children}</th>;
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top text-[#424956] ${className}`}>{children}</td>;
}
