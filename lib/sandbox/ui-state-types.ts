import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type { PreviewOverlayStatus } from "@/lib/sandbox/preview-overlay-status";
import type { SandboxRecord, StopReason } from "@/lib/types";

export type { PreviewOverlayStatus } from "@/lib/sandbox/preview-overlay-status";

export type SandboxUiState =
  | { kind: "no_session" }
  | { kind: "no_sandbox"; branch: string | null; lastSandboxId: string | null }
  | {
      kind: "booting";
      sandboxId: string;
      phase: "creating" | "installing";
      runtimeStatus?: "pausing";
    }
  | { kind: "starting"; sandboxId: string; previewUrl: string | null }
  | {
      kind: "live";
      sandboxId: string;
      previewUrl: string;
      expiresAt: string;
    }
  | {
      kind: "degraded";
      sandboxId: string;
      reason: "app_error" | "unreachable" | "idle_warning";
      previewUrl: string | null;
    }
  | { kind: "paused"; sandboxId: string; snapshotId: string | null }
  | {
      kind: "stopped";
      sandboxId: string;
      reason: StopReason | null;
      branch: string;
    }
  | { kind: "errored"; sandboxId: string; message: string };

export type SandboxUiBundle = {
  state: SandboxUiState;
  overlayStatus: PreviewOverlayStatus;
};

export type SandboxUiSession = {
  activeSandboxId?: string | null;
  pendingSandboxBranch?: string | null;
};

export type ResolveSandboxUiStateInput = {
  session: SandboxUiSession | null;
  record: SandboxRecord | null;
  liveProbe?: SandboxHealthStatus;
};
