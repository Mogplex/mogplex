import {
  isSchemaDriftError,
  SCHEMA_DRIFT_CODE,
  SCHEMA_DRIFT_MESSAGE,
} from "./schema-drift";

export const clientDeploymentId =
  process.env.NEXT_PUBLIC_MOGPLEX_DEPLOYMENT_ID ?? "";

function apiUrl(input: RequestInfo | URL, origin: string): URL | null {
  try {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      origin
    );
    return url.origin === new URL(origin).origin &&
      (url.pathname === "/api" || url.pathname.startsWith("/api/"))
      ? url
      : null;
  } catch {
    return null;
  }
}

// EventSource cannot set headers. Its reconnects retain this URL and release.
export function deploymentStreamUrl(
  path: string,
  deploymentId = clientDeploymentId
): string {
  if (!deploymentId || !path.startsWith("/api/")) return path;
  const url = new URL(path, "https://local.invalid");
  url.searchParams.set("dpl", deploymentId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function createDeploymentFetch(
  fetchImpl: typeof fetch,
  {
    origin,
    deploymentId,
    onSchemaDrift,
  }: {
    origin: string;
    deploymentId: string;
    onSchemaDrift: () => void;
  }
): typeof fetch {
  return async (input, init) => {
    if (!apiUrl(input, origin)) return fetchImpl(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (deploymentId) headers.set("x-deployment-id", deploymentId);
    const response = await fetchImpl(input, { ...init, headers });
    if (
      response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      return response;
    // Inspect only failed JSON responses. Leave successful streams and bodies
    // untouched, and never replay a request that may already have side effects.
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (!isSchemaDriftError(body)) return response;
    onSchemaDrift();
    const responseHeaders = new Headers(response.headers);
    for (const name of ["content-length", "content-encoding", "etag"])
      responseHeaders.delete(name);
    responseHeaders.set("cache-control", "no-store");
    return Response.json(
      { error: SCHEMA_DRIFT_MESSAGE, code: SCHEMA_DRIFT_CODE },
      { status: 503, headers: responseHeaders }
    );
  };
}
