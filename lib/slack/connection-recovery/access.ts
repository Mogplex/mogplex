import {
  getAllUserConnections,
  getResolvedConnections,
  getConnectionCredentials,
} from "@/lib/connections/service";
import {
  canPrepareOAuthConnection,
  getValidAccessToken,
} from "@/lib/connections/oauth";
import { getMcpTools } from "@/lib/connections/mcp-tools";
import { getConnectionPreset } from "@/lib/connections/presets";
import {
  hasCapability,
  resolveMemberCapabilities,
  ALL_CAPABILITIES,
} from "@/lib/team-capabilities";
import type { ConnectionRecoveryRequest } from "./store";
import {
  checkGithubRecoveryAccess,
  githubRecoveryAuthorizePath,
} from "./github";
import { loadSlackVercelProjects, SlackVercelAccessError } from "./vercel";
import {
  connectionRecoveryPath,
  type RecoveryPresentation,
} from "./presentation";
import { findRecoveryRepository } from "./repository";
import { describeConnectionScope } from "./connection-scope";

const accessDeps = {
  checkGithub: checkGithubRecoveryAccess,
  loadVercel: loadSlackVercelProjects,
  getMcpTools,
};

export async function canRecoverConnection(
  userId: string,
  teamId: string | null,
  provider: string
) {
  const capabilities = teamId
    ? await resolveMemberCapabilities(userId, teamId)
    : ALL_CAPABILITIES;
  return hasCapability(
    capabilities,
    provider === "github" ? "tools.github_api" : "connections.create"
  );
}

export async function loadRecoveryConnector(
  request: ConnectionRecoveryRequest
) {
  if (request.target.provider !== "connection") return null;
  const id = request.target.connectionId;
  return (
    (await getAllUserConnections(request.user_id)).find(
      (conn) => conn.id === id
    ) ?? null
  );
}

export async function describeRecoveryConnector(
  request: ConnectionRecoveryRequest
): Promise<
  Pick<
    RecoveryPresentation,
    "name" | "icon" | "restoreRepository" | "scopeRepair"
  >
> {
  const connection = await loadRecoveryConnector(request);
  const preset = getConnectionPreset(connection?.source_preset);
  const repo = await findRecoveryRepository(request);
  return {
    name: connection?.name,
    icon: preset?.id ?? "connection",
    restoreRepository: repo?.is_hidden === true,
    scopeRepair: await describeConnectionScope(request),
  };
}

export async function recoveryAuthorizePath(
  request: ConnectionRecoveryRequest
) {
  const next = encodeURIComponent(
    `${connectionRecoveryPath(request.id)}&complete=1`
  );
  if (request.target.provider === "github")
    return githubRecoveryAuthorizePath(request.user_id, request.target, next);
  if (request.target.provider === "vercel")
    return `/api/auth/vercel?next=${next}`;
  const connection = await loadRecoveryConnector(request);
  if (!connection) return null;
  return canPrepareOAuthConnection(connection)
    ? `/api/connections/oauth?connectionId=${connection.id}&next=${next}`
    : "/connections";
}

export async function checkConnectionRecoveryAccess(
  request: ConnectionRecoveryRequest,
  overrides: Partial<typeof accessDeps> = {}
): Promise<{ ready: boolean; message: string }> {
  const deps = { ...accessDeps, ...overrides };
  if (
    !(await canRecoverConnection(
      request.user_id,
      request.product_team_id,
      request.target.provider
    ))
  ) {
    return {
      ready: false,
      message:
        "Your Mogplex team role no longer allows this connection. Ask a team owner to update your access.",
    };
  }
  try {
    if (request.target.provider === "github") {
      if ((await findRecoveryRepository(request))?.is_hidden)
        return {
          ready: false,
          message:
            "This repository is removed from Mogplex. Restore it in this dialog to continue.",
        };
      const ready = await deps.checkGithub(request.user_id, request.target, {
        productTeamId: request.product_team_id,
        repoId: request.repo_id,
      });
      return {
        ready,
        message: ready
          ? "GitHub access verified."
          : "GitHub has not granted the requested repository access yet. Authorize the repository and any pending app permissions, then check again.",
      };
    }
    if (request.target.provider === "vercel") {
      await deps.loadVercel(request.user_id, request.target.team);
      return { ready: true, message: "Vercel project access verified." };
    }
    const connection = await loadRecoveryConnector(request);
    if (!connection?.is_enabled)
      return {
        ready: false,
        message:
          "This connection is disabled or no longer available. Use the enable action in this dialog if available, then check again.",
      };
    if (
      request.repo_id &&
      !(await getResolvedConnections(request.user_id, request.repo_id)).some(
        (conn) => conn.id === connection.id
      )
    ) {
      return {
        ready: false,
        message:
          "This connection is not available to the requested repository. Use the scope action in this dialog, then check again.",
      };
    }
    if (connection.approval_mode === "ask")
      return {
        ready: false,
        message:
          "This connection requires approval for each tool call. Continue in Mogplex where those approvals are available.",
      };
    if (
      connection.type !== "mcp_server" ||
      connection.mcp_transport === "stdio"
    )
      return {
        ready: false,
        message:
          "This connection needs its provider-specific setup in Mogplex connection settings.",
      };
    const credential =
      connection.auth_type === "oauth"
        ? await getValidAccessToken(connection)
        : await getConnectionCredentials(connection.id);
    const mcp = await deps.getMcpTools(connection, credential || undefined);
    await mcp.cleanup();
    return {
      ready: true,
      message:
        "Connection authorized. The agent will verify the access needed by your request.",
    };
  } catch (error) {
    return {
      ready: false,
      message:
        error instanceof SlackVercelAccessError
          ? error.message
          : "Access could not be verified. Complete the provider authorization and check again.",
    };
  }
}
