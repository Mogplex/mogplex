import type { MissionPermissions } from "@/lib/control/types";

export function ControlPermissionsNote({ permissions }: { permissions: MissionPermissions }) {
  if (permissions !== "Approve Edits") return null;
  return <p id="control-permissions-note" role="note" className="text-muted-foreground mt-2 max-w-prose text-xs">
    Codex workers cannot commit in this mode. Choose Skip Permissions to let them deliver.
  </p>;
}
