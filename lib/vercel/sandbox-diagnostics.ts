export type SandboxVercelDiagnosticsState =
  | "ready"
  | "building"
  | "build_failed"
  | "deployment_missing"
  | "inaccessible"
  | "platform_not_configured";

export type SandboxVercelDiagnostics = {
  state: SandboxVercelDiagnosticsState;
  deploymentId: string | null;
  deploymentUrl: string | null;
  deploymentStatus: string | null;
  buildSummary: string | null;
  detectedAt: string | null;
};

export function formatSandboxVercelDiagnosticsState(
  state: SandboxVercelDiagnosticsState
) {
  switch (state) {
    case "ready":
      return "Ready";
    case "building":
      return "Building";
    case "build_failed":
      return "Build failed";
    case "deployment_missing":
      return "No deployment";
    case "platform_not_configured":
      return "Platform unavailable";
    case "inaccessible":
      return "Inaccessible";
  }
}

export function presentSandboxVercelDiagnostics(
  diag: SandboxVercelDiagnostics | null | undefined
) {
  if (!diag) return null;

  const title =
    diag.state === "build_failed"
      ? "Latest Vercel deployment failed to build"
      : diag.state === "building"
        ? "Vercel deployment is still building"
        : diag.state === "deployment_missing"
          ? "No deployment found for linked Vercel project"
          : diag.state === "platform_not_configured"
            ? "Vercel diagnostics are unavailable"
            : diag.state === "inaccessible"
              ? "Linked Vercel deployment is unavailable"
              : "Vercel deployment is ready";

  return {
    title,
    stateLabel: formatSandboxVercelDiagnosticsState(diag.state),
    summary:
      diag.buildSummary ||
      (diag.state === "ready"
        ? "The latest Vercel deployment is ready."
        : null),
  };
}
