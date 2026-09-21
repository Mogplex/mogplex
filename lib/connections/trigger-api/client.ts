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

export type TriggerRunFilters = {
  status?: string[];
  taskIdentifier?: string[];
  tag?: string[];
  version?: string;
  period?: string;
  limit?: number;
  cursor?: string;
};

export class TriggerApiError extends Error {
  status: number;

  constructor(status: number, detail: string) {
    super(`Trigger.dev API returned HTTP ${status}: ${detail}`);
    this.name = "TriggerApiError";
    this.status = status;
  }
}

type RequestOptions = {
  token: string;
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | undefined>;
  branch?: string;
};

function buildUrl(path: string, query: RequestOptions["query"]) {
  const url = new URL(path, TRIGGER_API_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
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

/**
 * Trigger.dev REST client for a Personal Access Token. Account-level routes
 * take the token directly; environment routes take a short-lived JWT minted
 * from it with only the scopes that call needs, the same exchange the official
 * MCP server performs.
 */
export function createTriggerApiClient(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
) {
  async function request<T>(path: string, options: RequestOptions): Promise<T> {
    const res = await fetchImpl(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        ...(options.branch ? { "x-trigger-branch": options.branch } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok)
      throw new TriggerApiError(res.status, await readErrorDetail(res));
    return (await res.json()) as T;
  }

  async function mintEnvironmentToken(
    target: TriggerEnvironmentTarget,
    scopes: string[]
  ) {
    const project = encodeURIComponent(target.projectRef);
    const { token } = await request<{ token: string }>(
      `/api/v1/projects/${project}/${target.environment}/jwt`,
      {
        token: accessToken,
        method: "POST",
        body: { claims: { scopes } },
        branch: target.branch,
      }
    );
    return token;
  }

  return {
    listProjects: () =>
      request<unknown[]>("/api/v1/projects", { token: accessToken }),

    getCurrentWorker: (target: TriggerEnvironmentTarget) =>
      request<{ worker?: Record<string, unknown> }>(
        `/api/v1/projects/${encodeURIComponent(target.projectRef)}/${target.environment}/workers/current`,
        { token: accessToken, branch: target.branch }
      ),

    async listRuns(
      target: TriggerEnvironmentTarget,
      filters: TriggerRunFilters
    ) {
      const token = await mintEnvironmentToken(target, ["read:runs"]);
      return request<{ data?: unknown[]; pagination?: { next?: string } }>(
        "/api/v1/runs",
        {
          token,
          query: {
            "filter[status]": filters.status?.join(","),
            "filter[taskIdentifier]": filters.taskIdentifier?.join(","),
            "filter[tag]": filters.tag?.join(","),
            "filter[version]": filters.version,
            "filter[createdAt][period]": filters.period,
            "page[size]": filters.limit?.toString(),
            "page[after]": filters.cursor,
          },
        }
      );
    },

    async retrieveRunWithTrace(
      target: TriggerEnvironmentTarget,
      runId: string
    ) {
      const token = await mintEnvironmentToken(target, [`read:runs:${runId}`]);
      const run = encodeURIComponent(runId);
      const [details, trace] = await Promise.all([
        request<Record<string, unknown>>(`/api/v3/runs/${run}`, { token }),
        request<{ trace?: { rootSpan?: unknown } }>(
          `/api/v1/runs/${run}/trace`,
          { token }
        ),
      ]);
      return { details, trace: trace.trace };
    },

    async triggerTask(
      target: TriggerEnvironmentTarget,
      taskId: string,
      body: { payload: unknown; options?: Record<string, unknown> }
    ) {
      const token = await mintEnvironmentToken(target, ["write:tasks"]);
      return request<{ id: string }>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/trigger`,
        { token, method: "POST", body }
      );
    },

    async cancelRun(target: TriggerEnvironmentTarget, runId: string) {
      const token = await mintEnvironmentToken(target, [
        `write:runs:${runId}`,
        `read:runs:${runId}`,
      ]);
      const run = encodeURIComponent(runId);
      await request(`/api/v2/runs/${run}/cancel`, { token, method: "POST" });
      return request<Record<string, unknown>>(`/api/v3/runs/${run}`, { token });
    },

    async listDeployments(
      target: TriggerEnvironmentTarget,
      filters: {
        status?: string;
        period?: string;
        limit?: number;
        cursor?: string;
      }
    ) {
      const token = await mintEnvironmentToken(target, ["read:deployments"]);
      return request<{ data?: unknown[]; pagination?: { next?: string } }>(
        "/api/v1/deployments",
        {
          token,
          query: {
            status: filters.status,
            period: filters.period,
            "page[size]": filters.limit?.toString(),
            "page[after]": filters.cursor,
          },
        }
      );
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
      if (!res.ok)
        throw new TriggerApiError(res.status, await readErrorDetail(res));
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
