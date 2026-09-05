import type { HarnessExecutionMode } from "./claude-permissions";

/** Honor the selected mode even when resuming a previously read-only session. */
export function buildCodexPermissionArgs(
  mode?: HarnessExecutionMode
): string[] {
  const sandbox =
    mode === "SAFE"
      ? "read-only"
      : mode === "YOLO"
        ? "danger-full-access"
        : "workspace-write";
  // Workers have no interactive approval channel. AUTO must remain sandboxed;
  // a denied operation is reported, never escalated to broader permissions.
  return ["-c", `sandbox_mode="${sandbox}"`, "-c", 'approval_policy="never"'];
}
