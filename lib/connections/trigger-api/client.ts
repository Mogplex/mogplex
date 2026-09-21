const TRIGGER_API_URL = "https://api.trigger.dev";
const TRIGGER_DOCS_MCP_URL = "https://trigger.dev/docs/mcp";
const REQUEST_TIMEOUT_MS = 20_000;

export const TRIGGER_ENVIRONMENTS = [
  "dev",
  "staging",
  "prod",
  "preview",
] as const;

export type TriggerEnvironment = (typeof TRIGGER_ENVIRONMENTS)[number];

/** One project environment; `branch` only applies to `preview`. */
export type TriggerEnvironmentTarget = {
  projectRef: string;
  environment: TriggerEnvironment;
  branch?: string;
};

/**
 * How a call authenticates. All three start from the saved Personal Access
 * Token and none of them leaves the server:
 * - `pat`: account-level routes take the token itself.
 * - `jwt`: a short-lived token carrying only these scopes, for routes that
 *   accept one. This is the exchange the official MCP server performs.
 * - `env_key`: the environment's secret key, for management routes that accept
 *   nothing else. The CLI bootstraps the same way.
 */
export type TriggerAuth =
  | { kind: "pat" }
  | { kind: "jwt"; target: TriggerEnvironmentTarget; scopes: string[] }
  | { kind: "env_key"; target: TriggerEnvironmentTarget };

export type TriggerQuery = Record<string, string | number | undefined>;

export type TriggerRequest = {
  auth: TriggerAuth;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: TriggerQuery;
  body?: unknown;
};

export class TriggerApiError extends Error {
  status: number;

  constructor(status: number, detail: string) {
    super(`Trigger.dev API returned HTTP ${status}: ${detail}`);
    this.name = "TriggerApiError";
    this.status = status;
  }
}

function buildUrl(path: string, query: TriggerQuery | undefined) {
  const url = new URL(path, TRIGGER_API_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readErrorDetail(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    const detail = parsed.error ?? parsed.message;
    if (typeof detail === "string" && detail) return detail;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, 300) || res.statusText || "request failed";
}

/** Docs search answers as JSON or as an SSE stream whose first data line is the JSON. */
function parseJsonRpcBody(text: string, contentType: string | null): unknown {
  if (!contentType?.includes("text/event-stream")) return JSON.parse(text);
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error("Trigger.dev docs search returned no data");
  return JSON.parse(dataLine.slice("data:".length).trim());
}

function targetPath(target: TriggerEnvironmentTarget) {
  return `/api/v1/projects/${encodeURIComponent(target.projectRef)}/${target.environment}`;
}

/** Trigger.dev REST client for one saved Personal Access Token. */
export function createTriggerApiClient(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
) {
  // Lives as long as this client, which is one turn: a key fetched for the
  // first call serves the rest, and nothing outlives the request.
  const environmentKeys = new Map<string, Promise<string>>();

  async function send<T>(
    path: string,
    token: string,
    options: Pick<TriggerRequest, "method" | "query" | "body"> & {
      branch?: string;
    }
  ): Promise<T> {
    const res = await fetchImpl(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.branch ? { "x-trigger-branch": options.branch } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new TriggerApiError(res.status, await readErrorDetail(res));
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function mintScopedToken(
    target: TriggerEnvironmentTarget,
    scopes: string[]
  ) {
    const { token } = await send<{ token: string }>(
      `${targetPath(target)}/jwt`,
      accessToken,
      { method: "POST", body: { claims: { scopes } }, branch: target.branch }
    );
    return token;
  }

  function environmentKey(target: TriggerEnvironmentTarget) {
    const cacheKey = `${target.projectRef}:${target.environment}:${target.branch ?? ""}`;
    const cached = environmentKeys.get(cacheKey);
    if (cached) return cached;
    const pending = send<{ apiKey: string }>(targetPath(target), accessToken, {
      branch: target.branch,
    }).then((env) => env.apiKey);
    // A failed lookup must not poison later calls in the same turn.
    pending.catch(() => environmentKeys.delete(cacheKey));
    environmentKeys.set(cacheKey, pending);
    return pending;
  }

  async function resolveToken(auth: TriggerAuth) {
    if (auth.kind === "pat") return accessToken;
    if (auth.kind === "jwt") return mintScopedToken(auth.target, auth.scopes);
    return environmentKey(auth.target);
  }

  return {
    async request<T = unknown>(req: TriggerRequest): Promise<T> {
      const token = await resolveToken(req.auth);
      return send<T>(req.path, token, {
        method: req.method,
        query: req.query,
        body: req.body,
        branch: req.auth.kind === "pat" ? undefined : req.auth.target.branch,
      });
    },

    /** Account-level call that still names a preview branch. */
    requestWithPat<T = unknown>(
      path: string,
      options: Pick<TriggerRequest, "method" | "query" | "body"> & {
        branch?: string;
      } = {}
    ) {
      return send<T>(path, accessToken, options);
    },

    /** Public docs search; sends no credential. */
    async searchDocs(query: string) {
      const res = await fetchImpl(TRIGGER_DOCS_MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search_trigger_dev", arguments: { query } },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new TriggerApiError(res.status, await readErrorDetail(res));
      }
      const parsed = parseJsonRpcBody(
        await res.text(),
        res.headers.get("content-type")
      ) as { result?: { content?: Array<{ type?: string; text?: string }> } };
      return (parsed.result?.content ?? [])
        .map((part) => part.text ?? "")
        .filter(Boolean)
        .join("\n\n");
    },
  };
}

export type TriggerApiClient = ReturnType<typeof createTriggerApiClient>;
