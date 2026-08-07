import { getPlatformSandboxCredentials } from "@/lib/sandbox/get-user-credentials";
import type { VercelPlatformState } from "./capabilities";
import type {
  VercelServiceAccess,
  VercelServiceResult,
  VercelTeamSummary,
  VercelProjectSummary,
  VercelProjectEnvVar,
  VercelFetch,
  UpsertEnvVarInput,
} from "./service-types";
import { resolveAccess, appendTeamId, mapError } from "./service-errors";
import {
  buildEnvVarUpsertRequest,
  buildUpdatedEnvVarResult,
} from "./service-helpers";

// Re-export types for consumers
export type {
  VercelAuthMode,
  VercelServiceErrorCode,
  VercelServiceError,
  VercelServiceResult,
  VercelServiceAccess,
  VercelTeamSummary,
  VercelProjectSummary,
  VercelDeploymentSummary,
  VercelDeploymentLogEvent,
  VercelProjectEnvVar,
} from "./service-types";

// Re-export deployment operations
export {
  listVercelDeployments,
  getVercelDeployment,
  listVercelDeploymentBuildLogs,
} from "./service-deployments";

export function getPlatformVercelServiceState(): {
  platformState: VercelPlatformState;
  canUsePlatformOps: boolean;
} {
  const platform = getPlatformSandboxCredentials();
  const canUsePlatformOps = Boolean(
    platform.vercelToken && platform.vercelProjectId
  );
  return {
    platformState: canUsePlatformOps ? "ready" : "not_configured",
    canUsePlatformOps,
  };
}

export async function listVercelTeams(
  access: VercelServiceAccess,
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelTeamSummary[]>> {
  const resolved = resolveAccess(access);
  if (!resolved.ok) return resolved;

  const response = await fetchImpl(
    "https://api.vercel.com/v2/teams?limit=100",
    {
      headers: resolved.data.headers,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return mapError(response, {
      operation: "teams",
      teamScoped: false,
    });
  }

  const data = (await response.json()) as {
    teams?: Array<{ id: string; name?: string; slug?: string }>;
  };

  return {
    ok: true,
    data: (data.teams || []).map((team) => ({
      id: team.id,
      name: team.slug || team.name || team.id,
    })),
  };
}

export async function listVercelProjects(
  access: VercelServiceAccess,
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelProjectSummary[]>> {
  const resolved = resolveAccess(access);
  if (!resolved.ok) return resolved;

  const response = await fetchImpl(
    appendTeamId(
      "https://api.vercel.com/v10/projects?limit=100",
      resolved.data.teamId
    ),
    {
      headers: resolved.data.headers,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return mapError(response, {
      operation: "projects",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  const data = (await response.json()) as {
    projects?: Array<{ id: string; name: string; framework?: string | null }>;
  };

  return {
    ok: true,
    data: (data.projects || []).map((project) => ({
      id: project.id,
      name: project.name,
      framework: project.framework || null,
    })),
  };
}

export async function validateVercelProjectAccess(
  input: VercelServiceAccess & {
    projectId: string;
  },
  fetchImpl: VercelFetch = fetch
): Promise<
  VercelServiceResult<{
    projectId: string;
  }>
> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const response = await fetchImpl(
    appendTeamId(
      `https://api.vercel.com/v9/projects/${input.projectId}`,
      resolved.data.teamId
    ),
    {
      headers: resolved.data.headers,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return mapError(response, {
      operation: "project_validate",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  return {
    ok: true,
    data: {
      projectId: input.projectId,
    },
  };
}

export async function getVercelProjectDetails(
  input: VercelServiceAccess & {
    projectId: string;
  },
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelProjectSummary>> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const response = await fetchImpl(
    appendTeamId(
      `https://api.vercel.com/v9/projects/${input.projectId}`,
      resolved.data.teamId
    ),
    {
      headers: resolved.data.headers,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return mapError(response, {
      operation: "project_read",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  const payload = (await response.json()) as {
    id?: string;
    name?: string;
    framework?: string | null;
  };

  return {
    ok: true,
    data: {
      id: payload.id || input.projectId,
      name: payload.name || input.projectId,
      framework: payload.framework || null,
    },
  };
}

export async function createVercelProject(
  input: VercelServiceAccess & {
    name: string;
  },
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelProjectSummary>> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const response = await fetchImpl(
    appendTeamId("https://api.vercel.com/v11/projects", resolved.data.teamId),
    {
      method: "POST",
      headers: resolved.data.headers,
      cache: "no-store",
      body: JSON.stringify({ name: input.name }),
    }
  );

  if (!response.ok) {
    return mapError(response, {
      operation: "project_create",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  const payload = (await response.json()) as {
    id?: string;
    name?: string;
    framework?: string | null;
  };

  return {
    ok: true,
    data: {
      id: payload.id || "",
      name: payload.name || input.name,
      framework: payload.framework || null,
    },
  };
}

export async function listVercelProjectEnvVars(
  input: VercelServiceAccess & {
    projectId: string;
    decrypt?: boolean;
  },
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelProjectEnvVar[]>> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const baseUrl = appendTeamId(
    `https://api.vercel.com/v10/projects/${input.projectId}/env`,
    resolved.data.teamId
  );

  const envs: VercelProjectEnvVar[] = [];
  const seenIds = new Set<string>();
  let until: number | null = null;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(baseUrl);
    if (input.decrypt) {
      url.searchParams.set("decrypt", "true");
    }
    if (until !== null) {
      url.searchParams.set("until", String(until));
    }

    const response = await fetchImpl(url.toString(), {
      headers: resolved.data.headers,
      cache: "no-store",
    });

    if (!response.ok) {
      return mapError(response, {
        operation: "env_list",
        teamScoped: Boolean(resolved.data.teamId),
      });
    }

    const payload = (await response.json()) as {
      envs?: VercelProjectEnvVar[];
      pagination?: { next?: number | null };
    };
    const pageEnvs = payload.envs ?? [];
    for (const entry of pageEnvs) {
      if (entry.id) {
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
      }
      envs.push(entry);
    }

    const next = payload.pagination?.next;
    if (typeof next !== "number" || pageEnvs.length === 0) {
      return { ok: true, data: envs };
    }
    until = next;
  }

  return {
    ok: false,
    error: {
      code: "API_ERROR",
      message: `Vercel returned more than ${maxPages} pages of env vars; refusing to act on a partial list.`,
      status: 502,
    },
  };
}

export async function upsertVercelProjectEnvVar(
  input: UpsertEnvVarInput,
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<VercelProjectEnvVar>> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const request = buildEnvVarUpsertRequest(input, resolved.data.teamId);
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: resolved.data.headers,
    cache: "no-store",
    body: request.body,
  });

  if (!response.ok) {
    return mapError(response, {
      operation: "env_upsert",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  if (request.isUpdate) {
    return {
      ok: true,
      data: buildUpdatedEnvVarResult(input),
    };
  }

  return {
    ok: true,
    data: (await response.json()) as VercelProjectEnvVar,
  };
}

export async function deleteVercelProjectEnvVar(
  input: VercelServiceAccess & {
    projectId: string;
    envId: string;
  },
  fetchImpl: VercelFetch = fetch
): Promise<VercelServiceResult<{ ok: true }>> {
  const resolved = resolveAccess(input);
  if (!resolved.ok) return resolved;

  const response = await fetchImpl(
    appendTeamId(
      `https://api.vercel.com/v10/projects/${input.projectId}/env/${input.envId}`,
      resolved.data.teamId
    ),
    {
      method: "DELETE",
      headers: resolved.data.headers,
      cache: "no-store",
    }
  );

  if (!response.ok && response.status !== 404) {
    return mapError(response, {
      operation: "env_delete",
      teamScoped: Boolean(resolved.data.teamId),
    });
  }

  return {
    ok: true,
    data: { ok: true },
  };
}
