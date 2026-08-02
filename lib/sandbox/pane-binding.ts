import type { PaneNode } from "@/hooks/use-split-panes";
import { getPaneSandboxBinding } from "@/hooks/use-split-panes";

export function resolvePaneSandboxId(
  pane: Pick<PaneNode, "type" | "sandboxBinding" | "sandboxId">,
  activeSandboxId?: string | null
) {
  const binding = getPaneSandboxBinding(pane);

  if (binding === "pinned") {
    return pane.sandboxId || undefined;
  }

  if (binding === "session") {
    return activeSandboxId || pane.sandboxId || undefined;
  }

  return pane.sandboxId || activeSandboxId || undefined;
}
