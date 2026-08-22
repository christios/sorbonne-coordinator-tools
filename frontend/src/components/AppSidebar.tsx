import { SidePane } from "@/components/SidePane";
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
 * only — once an app is open, that app owns the whole width, and brings its own pane
 * if it has pages of its own.
 */
export function AppSidebar({ onOpen, onOpenSettings }: Props) {
  return (
    <SidePane
      label="Apps"
      heading="Workspace"
      items={COORDINATOR_APPS.map(({ id, name, icon }) => ({ id, name, icon }))}
      onSelect={(id) => onOpen(id as ToolId | "handbook")}
      footer={<StaffMenu variant="sidebar" onOpenSettings={onOpenSettings} />}
    />
  );
}
