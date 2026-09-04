/**
 * Name-scoped Vercel sandbox helpers that work without a `Sandbox` handle.
 *
 * Vercel keeps a named-sandbox entity after its last session ends and its
 * snapshot expires. In that state `GET /v2/sandboxes/:name` returns 404
 * ("has no latest sandbox") while `POST /v2/sandboxes` with the same name is
 * rejected as a duplicate. The SDK cannot return a handle for such a name, so
 * the list endpoint is the only way to see it and the raw DELETE endpoint is
 * the only way to free it.
 */
import { listVercelSandboxes } from "@/lib/sandbox/client-lifecycle";
import { isNotFoundError } from "@/lib/sandbox/sdk-adapter";

export type VercelSandboxCredentials = {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
};

export type VercelNamedSandboxSummary = {
  name: string;
  status?: string;
  persistent?: boolean;
};

const VERCEL_API_BASE = "https://api.vercel.com";

/**
 * Look a sandbox up by exact name through the list endpoint, which still
 * reports names whose sessions and snapshots are gone. Returns null when the
 * project has no sandbox with that name.
 */
export async function findVercelSandboxByName(
  name: string,
  credentials: VercelSandboxCredentials,
  deps: { listSandboxes?: typeof listVercelSandboxes } = {}
): Promise<VercelNamedSandboxSummary | null> {
  const listSandboxes = deps.listSandboxes ?? listVercelSandboxes;
  const sandboxes = await listSandboxes(credentials, {
    sortBy: "name",
    sortOrder: "asc",
    namePrefix: name,
    limit: 10,
  });
  const match = sandboxes.find((sandbox) => sandbox.name === name);
  if (!match) return null;
  return {
    name: match.name,
    status: typeof match.status === "string" ? match.status : undefined,
    persistent:
      typeof match.persistent === "boolean" ? match.persistent : undefined,
  };
}

/**
 * Delete a sandbox by name via the REST API. A 404 means the name is already
 * free, which is the outcome the caller wants, so it resolves normally.
 */
export async function deleteVercelSandboxByName(
  name: string,
  credentials: VercelSandboxCredentials,
  deps: { fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(
    `/v2/sandboxes/${encodeURIComponent(name)}`,
    VERCEL_API_BASE
  );
  url.searchParams.set("projectId", credentials.vercelProjectId);
  if (credentials.vercelTeamId) {
    url.searchParams.set("teamId", credentials.vercelTeamId);
  }

  const response = await fetchImpl(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${credentials.vercelToken}` },
    cache: "no-store",
  });
  if (response.ok || response.status === 404) return;

  const detail = await response.text().catch(() => "");
  const error = Object.assign(
    new Error(
      `Failed to delete Vercel sandbox '${name}': ${response.status}${
        detail ? ` ${detail.slice(0, 300)}` : ""
      }`
    ),
    { status: response.status }
  );
  if (isNotFoundError(error)) return;
  throw error;
}
