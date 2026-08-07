import type {
  VercelServiceAccess,
  VercelServiceResult,
  VercelDeploymentSummary,
  VercelDeploymentLogEvent,
  VercelFetch,
  RawVercelDeployment,
} from "./service-types";
import { resolveAccess, appendTeamId, mapError } from "./service-errors";
import { buildDeploymentSummary } from "./service-helpers";

export async function listVercelDeployments(
  input: VercelServiceAccess & {
    projectId: string;
    limit?: number;
  },
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelDeploymentSummary[]>> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const url = new URL(
    appendTeamId("https://api.vercel.com/v6/deployments", resolved.data.teamId)
  );
  url.searchParams.set("projectId", input.projectId);
  url.searchParams.set("limit", String(input.limit ?? 20));

  const response = await fetchImpl(url.toString(), {
    headers: resolved.data.headers,
    cache: "no-store",
  });

  if (!response.ok) {
    return mapError(response, {
      operation: "deployment_list",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  const payload = (await response.json()) as
    | {
        deployments?: RawVercelDeployment[];
      }
    | RawVercelDeployment[];

  const deployments = Array.isArray(payload)
    ? payload
    : payload.deployments || [];

  return {
    ok: true,
    data: deployments.map((deployment) =>
      buildDeploymentSummary(deployment, input.projectId, "")
    ),
  };
}

export async function getVercelDeployment(
  input: VercelServiceAccess & {
    deploymentId: string;
  },
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelDeploymentSummary>> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const response = await fetchImpl(
    appendTeamId(
      `https://api.vercel.com/v13/deployments/${input.deploymentId}`,
      resolved.data.teamId
    ),
    {
      headers: resolved.data.headers,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return mapError(response, {
      operation: "deployment_read",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  const payload = (await response.json()) as RawVercelDeployment;

  return {
    ok: true,
    data: buildDeploymentSummary(
      payload,
      input.deploymentId,
      input.deploymentId
    ),
  };
}

export async function listVercelDeploymentBuildLogs(
  input: VercelServiceAccess & {
    deploymentId: string;
    limit?: number;
  },
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelDeploymentLogEvent[]>> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const url = new URL(
    appendTeamId(
      `https://api.vercel.com/v3/deployments/${input.deploymentId}/events`,
      resolved.data.teamId
    )
  );
  url.searchParams.set("builds", "1");
  url.searchParams.set("direction", "backward");
  url.searchParams.set("limit", String(input.limit ?? 100));

  const response = await fetchImpl(url.toString(), {
    headers: resolved.data.headers,
    cache: "no-store",
  });

  if (!response.ok) {
    return mapError(response, {
      operation: "deployment_events",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  const payload = (await response.json()) as Array<{
    type?: string | null;
    created?: number | null;
    payload?: {
      text?: string | null;
      statusCode?: number | null;
      info?: {
        readyState?: string | null;
      };
    };
  }>;

  return {
    ok: true,
    data: (Array.isArray(payload) ? payload : []).map((event) => ({
      type: event.type || null,
      created: event.created ?? null,
      text: event.payload?.text || null,
      statusCode: event.payload?.statusCode ?? null,
      readyState: event.payload?.info?.readyState || null,
    })),
  };
}
