import {
  resolveSandboxLaunchIntentFromUiState,
  type SandboxLaunchIntent,
} from "@/lib/sandbox/launch-intent";
import type { Session } from "@/hooks/use-sessions";
import {
  resolveSandboxUiBundle,
  type SandboxUiBundle,
} from "@/lib/sandbox/ui-state";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type { SandboxRecord } from "@/lib/types";

export type PreviewPaneLaunchTrigger = "status_overlay" | "empty_state";

export type PreviewPaneLaunchContext = SandboxUiBundle & {
  effectiveSandboxRecordId: string | null;
  intent: SandboxLaunchIntent;
  shouldReserveStoppedOverlayLaunchAttempt: boolean;
};

export function resolvePreviewPaneLaunchContext({
  trigger,
  session = null,
  record,
  sandboxRecordId,
  liveProbe,
}: {
  trigger: PreviewPaneLaunchTrigger;
  session?: Session | null;
  record: SandboxRecord | null;
  sandboxRecordId: string | undefined;
  liveProbe?: SandboxHealthStatus;
}): PreviewPaneLaunchContext {
  const effectiveSandboxRecordId = sandboxRecordId ?? record?.id ?? null;
  const intentSandboxRecordId = effectiveSandboxRecordId ?? undefined;
  const bundle = resolveSandboxUiBundle({ session, record, liveProbe });
  // Empty-state launches are only forced fresh when there is no record to
  // correlate. A stopped record without a preview URL should still restart on
  // its branch and reserve an attempt ID so failures render against this click.
  const intent =
    trigger === "empty_state" && !effectiveSandboxRecordId
      ? { kind: "start_fresh" as const }
      : resolveSandboxLaunchIntentFromUiState(
          bundle.state,
          intentSandboxRecordId
        );

  return {
    ...bundle,
    effectiveSandboxRecordId,
    intent,
    shouldReserveStoppedOverlayLaunchAttempt:
      bundle.overlayStatus === "stopped" && intent.kind === "restart_on_branch",
  };
}
