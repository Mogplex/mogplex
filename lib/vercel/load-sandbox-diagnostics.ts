import {
  getVercelProjectDetails,
  getVercelDeployment,
  listVercelDeploymentBuildLogs,
  listVercelDeployments,
} from "@/lib/vercel/service";
import type {
  VercelAuthMode,
  VercelDeploymentLogEvent,
  VercelDeploymentSummary,
  VercelServiceAccess,
  VercelServiceError,
} from "@/lib/vercel/service";
import type {
  SandboxVercelDiagnostics,
  SandboxVercelDiagnosticsState,
} from "@/lib/vercel/sandbox-diagnostics";

function toDeploymentUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `https://${url}`;
}

function trimSummary(message: string | null | undefined, limit = 240) {
  if (!message) return null;
  const normalized = message.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 1)}…`
    : normalized;
}

function summarizeBuildLogEvents(events: VercelDeploymentLogEvent[]) {
  const prioritized = events
    .map((event) => trimSummary(event.text))
    .filter(Boolean) as string[];

  const explicitError = prioritized.find((text) =>
    /\b(error|failed|failure|fatal|exception)\b/i.test(text)
  );
  return explicitError ?? prioritized[0] ?? null;
}

function summarizeDeploymentFailure(
  deployment: VercelDeploymentSummary,
  events: VercelDeploymentLogEvent[]
) {
  return (
    trimSummary(deployment.errorMessage) ||
    trimSummary(deployment.readyStateReason) ||
    summarizeBuildLogEvents(events) ||
    "The latest Vercel deployment failed during the build or initialization phase."
  );
}

function diagnosticsTimestamp() {
  return new Date().toISOString();
}

function buildDiagnostics(
  state: SandboxVercelDiagnosticsState,
  details: Partial<Omit<SandboxVercelDiagnostics, "state">> = {}
): SandboxVercelDiagnostics {
  return {
    state,
    deploymentId: details.deploymentId ?? null,
    deploymentUrl: details.deploymentUrl ?? null,
    deploymentStatus: details.deploymentStatus ?? null,
    buildSummary: details.buildSummary ?? null,
    detectedAt: details.detectedAt ?? diagnosticsTimestamp(),
  };
}

function mapServiceErrorToDiagnostics(
  error: VercelServiceError,
  authMode: VercelAuthMode
) {
  if (error.code === "NOT_CONFIGURED") {
    return buildDiagnostics("platform_not_configured", {
      buildSummary:
        "Mogplex platform Vercel is not configured for deployment diagnostics.",
    });
  }

  if (error.code === "AUTH_INVALID") {
    return buildDiagnostics("inaccessible", {
      buildSummary:
        authMode === "personal"
          ? "Reconnect Personal Vercel to inspect the linked deployment."
          : "Mogplex could not authenticate to inspect the linked Vercel deployment.",
    });
  }

  if (error.code === "PROJECT_NOT_FOUND") {
    return buildDiagnostics("inaccessible", {
      buildSummary: "The linked Vercel project could not be found.",
    });
  }

  if (error.code === "PROJECT_FORBIDDEN" || error.code === "TEAM_FORBIDDEN") {
    return buildDiagnostics("inaccessible", {
      buildSummary: "Mogplex could not access the linked Vercel project.",
    });
  }

  if (error.code === "RATE_LIMITED") {
    return buildDiagnostics("inaccessible", {
      buildSummary:
        "Vercel rate limited deployment diagnostics. Try again shortly.",
    });
  }

  return buildDiagnostics("inaccessible", {
    buildSummary:
      trimSummary(error.message) ||
      "Mogplex could not load deployment diagnostics from Vercel.",
  });
}

function pickLatestDeployment(deployments: VercelDeploymentSummary[]) {
  return (
    [...deployments].sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
    )[0] ?? null
  );
}

function isBuildingState(readyState: string | null | undefined) {
  return (
    readyState === "QUEUED" ||
    readyState === "BUILDING" ||
    readyState === "INITIALIZING"
  );
}

function isFailureState(readyState: string | null | undefined) {
  return readyState === "ERROR" || readyState === "CANCELED";
}

export async function loadSandboxVercelDiagnostics(
  input: VercelServiceAccess & {
    projectId?: string | null;
  },
  fetchImpl: typeof fetch = fetch
): Promise<SandboxVercelDiagnostics | null> {
  const projectId = input.projectId?.trim() || null;
  if (!projectId) return null;

  const projectAccess = await getVercelProjectDetails(
    {
      authMode: input.authMode,
      vercelToken: input.vercelToken,
      teamId: input.teamId,
      projectId,
    },
    fetchImpl
  );
  if (!projectAccess.ok) {
    return mapServiceErrorToDiagnostics(projectAccess.error, input.authMode);
  }

  const deployments = await listVercelDeployments(
    {
      authMode: input.authMode,
      vercelToken: input.vercelToken,
      teamId: input.teamId,
      projectId,
      limit: 8,
    },
    fetchImpl
  );
  if (!deployments.ok) {
    return mapServiceErrorToDiagnostics(deployments.error, input.authMode);
  }

  const latest = pickLatestDeployment(deployments.data);
  if (!latest) {
    return buildDiagnostics("deployment_missing", {
      buildSummary: "No deployments were found for the linked Vercel project.",
    });
  }

  const deployment = await getVercelDeployment(
    {
      authMode: input.authMode,
      vercelToken: input.vercelToken,
      teamId: input.teamId,
      deploymentId: latest.id,
    },
    fetchImpl
  );

  const effectiveDeployment = deployment.ok ? deployment.data : latest;
  const deploymentUrl = toDeploymentUrl(effectiveDeployment.url);
  const deploymentStatus = effectiveDeployment.readyState;

  if (!deployment.ok && deployment.error.code !== "API_ERROR") {
    const diagnostics = mapServiceErrorToDiagnostics(
      deployment.error,
      input.authMode
    );
    return {
      ...diagnostics,
      deploymentId: latest.id,
      deploymentUrl,
      deploymentStatus,
    };
  }

  if (effectiveDeployment.readyState === "READY") {
    return buildDiagnostics("ready", {
      deploymentId: effectiveDeployment.id,
      deploymentUrl,
      deploymentStatus,
    });
  }

  if (isBuildingState(effectiveDeployment.readyState)) {
    return buildDiagnostics("building", {
      deploymentId: effectiveDeployment.id,
      deploymentUrl,
      deploymentStatus,
      buildSummary:
        trimSummary(effectiveDeployment.readyStateReason) ||
        "The latest Vercel deployment is still building.",
    });
  }

  if (isFailureState(effectiveDeployment.readyState)) {
    const buildLogs = await listVercelDeploymentBuildLogs(
      {
        authMode: input.authMode,
        vercelToken: input.vercelToken,
        teamId: input.teamId,
        deploymentId: effectiveDeployment.id,
        limit: 40,
      },
      fetchImpl
    );

    const buildSummary = summarizeDeploymentFailure(
      effectiveDeployment,
      buildLogs.ok ? buildLogs.data : []
    );

    return buildDiagnostics("build_failed", {
      deploymentId: effectiveDeployment.id,
      deploymentUrl,
      deploymentStatus,
      buildSummary,
    });
  }

  return buildDiagnostics("deployment_missing", {
    deploymentId: effectiveDeployment.id,
    deploymentUrl,
    deploymentStatus,
    buildSummary:
      "The linked Vercel project does not have a ready deployment yet.",
  });
}
