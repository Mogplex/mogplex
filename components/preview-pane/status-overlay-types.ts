import type { SandboxError } from "@/lib/sandbox/error-state";
import type { SandboxRecord } from "@/lib/types";
import type { PreviewOverlayStatus } from "@/lib/sandbox/preview-overlay-status";

export interface StatusOverlayProps {
  status: PreviewOverlayStatus;
  error?: SandboxError | null;
  details?: {
    runtime_summary: SandboxRecord["runtime_summary"];
    error_summary: SandboxRecord["error_summary"];
    dev_log?: SandboxRecord["dev_log"];
  } | null;
  launchLogs?: string;
  onLaunch?: () => void;
  onRestart?: () => void;
  onRetryHealth?: () => void;
  onOpenHealth?: () => void;
  onResume?: () => void;
  onStartFresh?: () => void;
  workingBranch?: string | null;
  startingStale?: boolean;
  repoId?: string;
}
