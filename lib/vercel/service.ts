import { getPlatformSandboxCredentials } from "@/lib/sandbox/get-user-credentials";
import type { VercelPlatformState } from "./capabilities";

export type VercelAuthMode = "platform" | "personal";

export type VercelServiceErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_INVALID"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_FORBIDDEN"
  | "TEAM_FORBIDDEN"
  | "RATE_LIMITED"
  | "API_ERROR";

export type VercelServiceError = {
  code: VercelServiceErrorCode;
  message: string;
  status: number;
};

export type VercelServiceResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: VercelServiceError;
    };

export type VercelServiceAccess = {
  authMode: VercelAuthMode;
  vercelToken?: string | null;
  teamId?: string | null;
};

export type VercelTeamSummary = {
  id: string;
  name: string;
};

export type VercelProjectSummary = {
  id: string;
  name: string;
  framework?: string | null;
};

export type VercelDeploymentSummary = {
  id: string;
  projectId: string | null;
  name: string;
  url: string | null;
  readyState: string | null;
  readySubstate: string | null;
  readyStateReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number | null;
  target: string | null;
  inspectorUrl: string | null;
};

export type VercelDeploymentLogEvent = {
  type: string | null;
  created: number | null;
  text: string | null;
  statusCode: number | null;
  readyState: string | null;
};

export type VercelProjectEnvVar = {
  id?: string;
  key: string;
  value?: string;
  target?: string[];
  type?: "encrypted" | "plain" | "secret" | "system";
  configurationId?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

type VercelFetch = typeof fetch;

type ResponseContext = {
  operation:
    | "teams"
    | "projects"
    | "project_validate"
    | "project_read"
    | "project_create"
    | "deployment_list"
    | "deployment_read"
    | "deployment_events"
    | "env_list"
    | "env_upsert"
    | "env_delete";
  teamScoped: boolean;
};

type RawVercelDeployment = {
  id?: string;
  projectId?: string | null;
  name?: string;
  url?: string | null;
  readyState?: string | null;
  readySubstate?: string | null;
  readyStateReason?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: number | null;
  target?: string | null;
  inspectorUrl?: string | null;
};

type UpsertEnvVarInput = VercelServiceAccess & {
  projectId: string;
  envId?: string;
  key?: string;
  value?: string;
  target?: string[];
  type?: string;
};

type EnvVarUpsertRequest = {
  isUpdate: boolean;
  method: "PATCH" | "POST";
  url: string;
  body: string;
};

const TEAM_FORBIDDEN_OPERATIONS = new Set<ResponseContext["operation"]>([
  "teams",
  "projects",
  "project_create",
]);

const PROJECT_NOT_FOUND_OPERATIONS = new Set<ResponseContext["operation"]>([
  "project_validate",
  "project_read",
  "deployment_list",
  "env_list",
  "env_upsert",
  "env_delete",
]);

function createError(
  code: VercelServiceErrorCode,
  status: number,
  message: string
): VercelServiceResult<never> {
  return {
    ok: false,
    error: {
      code,
      status,
      message,
    },
  };
}

function resolveAccess(input: VercelServiceAccess): VercelServiceResult<{
  headers: {
    Authorization: string;
    "Content-Type": string;
  };
  teamId: string | null;
}> {
  const vercelToken = input.vercelToken?.trim() || null;
  if (!vercelToken) {
    return input.authMode === "platform"
      ? createError(
          "NOT_CONFIGURED",
          500,
          "Mogplex platform Vercel is not configured."
        )
      : createError(
          "AUTH_INVALID",
          401,
          "Reconnect Personal Vercel to continue."
        );
  }

  return {
    ok: true,
    data: {
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      teamId: input.teamId?.trim() || null,
    },
  };
}

function appendTeamId(url: string, teamId?: string | null) {
  if (!teamId || teamId === "personal") return url;
  const nextUrl = new URL(url);
  nextUrl.searchParams.set("teamId", teamId);
  return nextUrl.toString();
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  return text || `Vercel API (${response.status})`;
}

function getForbiddenErrorCode(
  context: ResponseContext
): VercelServiceErrorCode {
  if (!TEAM_FORBIDDEN_OPERATIONS.has(context.operation)) {
    return "PROJECT_FORBIDDEN";
  }

  return context.teamScoped ? "TEAM_FORBIDDEN" : "AUTH_INVALID";
}

function getErrorCodeForStatus(
  status: number,
  context: ResponseContext
): VercelServiceErrorCode {
  switch (status) {
    case 401:
      return "AUTH_INVALID";
    case 403:
      return getForbiddenErrorCode(context);
    case 404:
      return PROJECT_NOT_FOUND_OPERATIONS.has(context.operation)
        ? "PROJECT_NOT_FOUND"
        : "API_ERROR";
    case 429:
      return "RATE_LIMITED";
    default:
      return "API_ERROR";
  }
}

async function mapError(
  response: Response,
  context: ResponseContext
): Promise<VercelServiceResult<never>> {
  const message = await readErrorMessage(response);
  return createError(
    getErrorCodeForStatus(response.status, context),
    response.status,
    message
  );
}

export function getPlatformVercelServiceState(): {
  platformState: VercelPlatformState;
  canUsePlatformOps: boolean;
} {
  // A deployment without platform Vercel config (self-hosted BYO, CI) is
  // simply not_configured — routes like /api/auth/user that only report the
  // state must not fail. Platform ops need both the token and the platform
  // project ID.
  const platform = getPlatformSandboxCredentials();
  const canUsePlatformOps = Boolean(
    platform.vercelToken && platform.vercelProjectId
  );
  return {
    platformState: canUsePlatformOps ? "ready" : "not_configured",
    canUsePlatformOps,
  };
}

function readOptionalString(value?: string | null) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringOrFallback(
  value: string | null | undefined,
  fallback: string
) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function buildDeploymentSummary(
  deployment: RawVercelDeployment,
  fallbackName: string,
  fallbackId: string
): VercelDeploymentSummary {
  return {
    id: readStringOrFallback(deployment.id, fallbackId),
    projectId: readOptionalString(deployment.projectId),
    name: readStringOrFallback(deployment.name, fallbackName),
    url: readOptionalString(deployment.url),
    readyState: readOptionalString(deployment.readyState),
    readySubstate: readOptionalString(deployment.readySubstate),
    readyStateReason: readOptionalString(deployment.readyStateReason),
    errorCode: readOptionalString(deployment.errorCode),
    errorMessage: readOptionalString(deployment.errorMessage),
    createdAt: deployment.createdAt ?? null,
    target: readOptionalString(deployment.target),
    inspectorUrl: readOptionalString(deployment.inspectorUrl),
  };
}

function buildEnvVarCreateBody(input: UpsertEnvVarInput) {
  return {
    key: input.key?.trim(),
    value: input.value ?? "",
    target: input.target || ["production", "preview", "development"],
    type: input.type || "encrypted",
  };
}

function buildEnvVarUpdateBody(input: UpsertEnvVarInput) {
  return {
    value: input.value ?? "",
    target: input.target,
  };
}

function buildEnvVarUpsertRequest(
  input: UpsertEnvVarInput,
  teamId: string | null
): EnvVarUpsertRequest {
  if (input.envId) {
    return {
      isUpdate: true,
      method: "PATCH",
      url: appendTeamId(
        `https://api.vercel.com/v10/projects/${input.projectId}/env/${input.envId}`,
        teamId
      ),
      body: JSON.stringify(buildEnvVarUpdateBody(input)),
    };
  }

  return {
    isUpdate: false,
    method: "POST",
    url: appendTeamId(
      `https://api.vercel.com/v10/projects/${input.projectId}/env`,
      teamId
    ),
    body: JSON.stringify(buildEnvVarCreateBody(input)),
  };
}

function buildUpdatedEnvVarResult(
  input: UpsertEnvVarInput
): VercelProjectEnvVar {
  return {
    id: input.envId,
    key: input.key || "",
    value: input.value ?? "",
    target: input.target,
    type: input.type as VercelProjectEnvVar["type"],
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
  // Key-wide mutations filter this list, so a partial page silently corrupts
  // them. Follow pagination.next until exhausted; a run past maxPages fails
  // loudly below rather than returning a truncated list as success.
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
    // The until bound can re-return the boundary entry; drop entries whose id
    // was already collected on an earlier page.
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
