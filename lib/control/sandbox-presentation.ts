const HISTORICAL_SANDBOX_STATUSES = new Set(["stopped", "error"]);

export function isCurrentControlSandbox(sandbox: {
  runtime_summary: { status: string };
}) {
  return !HISTORICAL_SANDBOX_STATUSES.has(sandbox.runtime_summary.status);
}

export function partitionControlSandboxes<
  T extends { runtime_summary: { status: string } },
>(sandboxes: T[]) {
  const current: T[] = [];
  const history: T[] = [];
  for (const sandbox of sandboxes) {
    (isCurrentControlSandbox(sandbox) ? current : history).push(sandbox);
  }
  return { current, history };
}

export type SandboxPreviewPresentation = {
  label: "Ready" | "Starting" | "App error" | "Unreachable" | "Unavailable";
  state: "ready" | "starting" | "error" | "unavailable";
  canOpen: boolean;
};

export function getSandboxPreviewPresentation(input: {
  status: string;
  healthStatus: string;
  previewUrl: string | null;
}): SandboxPreviewPresentation {
  if (input.status !== "running" || !input.previewUrl) {
    return { label: "Unavailable", state: "unavailable", canOpen: false };
  }
  if (
    input.healthStatus === "running" ||
    input.healthStatus === "idle_warning"
  ) {
    return { label: "Ready", state: "ready", canOpen: true };
  }
  if (input.healthStatus === "app_error") {
    return { label: "App error", state: "error", canOpen: true };
  }
  if (input.healthStatus === "unreachable") {
    return { label: "Unreachable", state: "error", canOpen: true };
  }
  return { label: "Starting", state: "starting", canOpen: true };
}
