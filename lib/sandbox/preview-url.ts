import {
  getSandboxUiPreviewUrl,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";
import type { SandboxRecord } from "@/lib/types";

export function resolvePreviewPaneUrl(
  pane: { type: string },
  sandboxRecord: SandboxRecord | null
) {
  if (pane.type !== "preview") return undefined;
  return getSandboxUiPreviewUrl(
    resolveSandboxUiState({ session: null, record: sandboxRecord })
  );
}
