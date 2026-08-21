import { StaffMenu } from "@/components/StaffMenu";
import { COORDINATOR_APPS } from "@/routes/apps";
import { ToolId } from "@/routes/toolRoute";

type Props = {
  onOpen: (app: ToolId | "handbook") => void;
  onOpenSettings: () => void;
};

/**
 * The left pane of the app picker: the same apps as the cards, in a list that stays
 * put, with the signed-in coordinator at the foot of it. It belongs to the picker
 * only — once an app is open, that app owns the whole width.
 */
export function AppSidebar({ onOpen, onOpenSettings }: Props) {
  return (
    <aside
      aria-label="Apps"
      className="hidden w-64 shrink-0 flex-col border-r border-[#d9dee7] bg-white lg:flex"
    >
      <nav className="flex flex-col gap-1 p-3">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
          Workspace
        </p>
        {COORDINATOR_APPS.map((app) => {
          const Icon = app.icon;
          return (
            <button
              type="button"
              key={app.id}
              onClick={() => onOpen(app.id)}
              title={app.name}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-[#424956] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
            >
              <Icon size={16} className="shrink-0 text-[#1f4e79]" aria-hidden="true" />
              <span className="truncate">{app.name}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-[#edf0f4] p-3">
        <StaffMenu variant="sidebar" onOpenSettings={onOpenSettings} />
      </div>
    </aside>
  );
}
