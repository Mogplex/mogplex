import type { SandboxRecord } from "@/lib/types";

/**
 * Project setup the boot could not finish while the VM itself is fine: no
 * recognized project manifest (`detect`), or a failed runtime prerequisite,
 * install, or dev server. The sandbox stays running so the agent or the user
 * can set the project up from inside it.
 */
export type SandboxSetupIssue = {
  phase: "detect" | "prerequisite" | "install" | "dev";
  message: string;
  /** Last lines of the failing step's output, for diagnosis. */
  logTail: string;
  /** Recognized missing-environment-variable pattern, if any. */
  envVarHint: string | null;
};

export type SandboxStateEvent =
  | {
      type: "status";
      status: "creating" | "installing" | "running" | "stopped" | "error";
      sandbox: SandboxRecord;
    }
  | {
      type: "sandbox_created";
      sandboxId: string;
      recordId: string;
      sandbox: SandboxRecord;
    }
  | {
      type: "preview_url";
      url: string;
      sandbox: SandboxRecord;
    }
  | {
      type: "ready";
      sandbox: SandboxRecord;
    };

export type SandboxEvent =
  | SandboxStateEvent
  | {
      type: "lifecycle";
      phase: "pending_cleanup";
      status: "waiting" | "recovered";
      sandboxId: string;
      operationId: string;
      elapsedMs: number;
      message: string;
    }
  | { type: "resume_required"; reason: "cleanup_recovered" }
  | { type: "warning"; message: string }
  | { type: "setup_issue"; issue: SandboxSetupIssue }
  | {
      type: "log";
      phase: "install" | "workspace" | "rebuild" | "dev";
      data: string;
    }
  | { type: "error"; message: string; phase?: string }
  | { type: "idle_warning"; minutesRemaining: number }
  | { type: "snapshot_restore"; snapshotId: string };

export type SandboxBootstrapStreamEvent =
  | { type: "warning"; message: string }
  | { type: "setup_issue"; issue: SandboxSetupIssue }
  | {
      type: "log";
      phase: "install" | "workspace" | "rebuild" | "dev";
      data: string;
    }
  | { type: "status"; status: "installing" | "running" }
  | { type: "preview_url"; url: string };
