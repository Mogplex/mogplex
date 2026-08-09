import { MOGPLEX_API_IDEMPOTENCY_KEY_HEADER } from "./request";
import { MogplexApiClientError } from "./client-error";
import type { MogplexApiAgent } from "./agents";
import type {
  CreateMogplexApiAutomationInput,
  ListMogplexApiAutomationsResult,
  MogplexApiAutomation,
  UpdateMogplexApiAutomationInput,
} from "./automations";
import type { MogplexApiEnvVar } from "./env-vars";
import type { MogplexApiModel } from "./models";
import type { PresentedAiCallEvent } from "./run-control";
import type { MogplexApiRepo } from "./repos";
import type { MogplexApiSandbox, MogplexApiSandboxLogs } from "./sandboxes";
import type { MogplexApiRunDetail, StartMogplexApiRunRequest } from "./runs";
import type { FlowRunDetail, FlowRunRecord } from "@/lib/types";

export { MogplexApiClientError } from "./client-error";

type MogplexApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

type QueryValue = boolean | number | string | null | undefined;

export type MogplexApiClientFetch = typeof fetch;

export type MogplexApiClientOptions = {
  baseUrl: string | URL;
  authorization: string;
  fetch?: MogplexApiClientFetch;
};

type MogplexApiClientRequestOptions = {
  method?: "DELETE" | "GET" | "POST" | "PUT";
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotencyKey?: string;
};

export type StartMogplexApiAgentRunInput = StartMogplexApiRunRequest & {
  idempotencyKey: string;
};

export type StartMogplexApiAgentRunResult = MogplexApiRunDetail & {
  replayed: boolean;
};

export type MogplexApiRunEventsResult = {
  run: MogplexApiRunDetail;
  events: PresentedAiCallEvent[];
};

export type MogplexApiRunCancelResult = {
  run: MogplexApiRunDetail;
  status: string;
};

export type RerunMogplexPrReviewResult = {
  queued: boolean;
  jobRunId: string | null;
  prNumber: number;
  repoId: string;
  started: boolean;
  deferred: boolean;
  reason: string | null;
  status: string | null;
  runtimeProvider: string | null;
  runtimeRunId: string | null;
  workflowRunId: string | null;
  versionFallbackUsed: boolean;
};

function normalizeAuthorization(value: string) {
  return value.startsWith("Bearer ") ? value : `Bearer ${value}`;
}

function normalizeBaseUrl(value: string | URL) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function appendQueryParams(url: URL, query?: Record<string, QueryValue>) {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
}

async function readEnvelope<T>(response: Response): Promise<T> {
  let payload: MogplexApiEnvelope<T>;
  try {
    payload = (await response.json()) as MogplexApiEnvelope<T>;
  } catch {
    throw new MogplexApiClientError(
      response.ok ? "INVALID_RESPONSE" : "HTTP_ERROR",
      response.ok
        ? "Mogplex returned an invalid JSON response"
        : `Mogplex API request failed with HTTP ${response.status}`,
      response.status
    );
  }

  if (!payload.ok) {
    throw new MogplexApiClientError(
      payload.error.code,
      payload.error.message,
      response.status
    );
  }

  return payload.data;
}

export class MogplexApiClient {
  private readonly baseUrl: URL;
  private readonly authorization: string;
  private readonly fetchImpl: MogplexApiClientFetch;

  constructor(options: MogplexApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authorization = normalizeAuthorization(options.authorization);
    this.fetchImpl = options.fetch ?? fetch;
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>) {
    if (!path.startsWith("/")) {
      throw new Error("Mogplex API paths must start with /");
    }

    const basePath = this.baseUrl.pathname === "/" ? "" : this.baseUrl.pathname;
    const url = new URL(`${basePath}${path}`, this.baseUrl);
    appendQueryParams(url, query);
    return url;
  }

  private async request<T>(
    path: string,
    options: MogplexApiClientRequestOptions = {}
  ) {
    const headers = new Headers({
      authorization: this.authorization,
      accept: "application/json",
    });
    let body: BodyInit | undefined;

    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey) {
      headers.set(MOGPLEX_API_IDEMPOTENCY_KEY_HEADER, options.idempotencyKey);
    }

    const response = await this.fetchImpl(this.buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
    });

    return readEnvelope<T>(response);
  }

  listRepos(input: { query?: string | null; limit?: number } = {}) {
    return this.request<{ repos: MogplexApiRepo[] }>("/api/v1/mogplex/repos", {
      query: {
        q: input.query,
        limit: input.limit,
      },
    });
  }

  listRepoEnvVars(input: { repoId: string }) {
    return this.request<{ envVars: MogplexApiEnvVar[] }>(
      `/api/v1/mogplex/repos/${encodeURIComponent(input.repoId)}/env-vars`
    );
  }

  upsertRepoEnvVar(input: {
    repoId: string;
    key: string;
    value: string;
    target?: string[];
    type?: string;
  }) {
    const { repoId, ...body } = input;
    return this.request<{
      action: "created" | "updated";
      key: string;
      updatedCount: number;
    }>(`/api/v1/mogplex/repos/${encodeURIComponent(repoId)}/env-vars`, {
      method: "POST",
      body,
    });
  }

  deleteRepoEnvVar(input: { repoId: string; key: string }) {
    const { repoId, ...body } = input;
    return this.request<{ key: string; deletedCount: number }>(
      `/api/v1/mogplex/repos/${encodeURIComponent(repoId)}/env-vars`,
      { method: "DELETE", body }
    );
  }

  listSandboxes(
    input: {
      repoId?: string | null;
      status?: string | null;
      limit?: number;
    } = {}
  ) {
    return this.request<{ sandboxes: MogplexApiSandbox[] }>(
      "/api/v1/mogplex/sandboxes",
      {
        query: {
          repo_id: input.repoId,
          status: input.status,
          limit: input.limit,
        },
      }
    );
  }

  createSandbox(input: {
    repoId: string;
    baseBranch?: string;
    workingBranch?: string;
    createBranch?: boolean;
    rootDirectory?: string | null;
  }) {
    return this.request<{ sandbox: MogplexApiSandbox }>(
      "/api/v1/mogplex/sandboxes",
      { method: "POST", body: input }
    );
  }

  getSandboxLogs(input: { sandboxId: string }) {
    return this.request<MogplexApiSandboxLogs>(
      `/api/v1/mogplex/sandboxes/${encodeURIComponent(input.sandboxId)}/logs`
    );
  }

  listAgents() {
    return this.request<{ agents: MogplexApiAgent[] }>(
      "/api/v1/mogplex/agents"
    );
  }

  listModels() {
    return this.request<{ models: MogplexApiModel[] }>(
      "/api/v1/mogplex/models"
    );
  }

  listAutomations(
    input: { limit?: number; cursor?: string | null } = {}
  ): Promise<ListMogplexApiAutomationsResult> {
    return this.request<ListMogplexApiAutomationsResult>(
      "/api/v1/mogplex/automations",
      { query: { limit: input.limit, cursor: input.cursor } }
    );
  }

  getAutomation(input: { automationId: string }) {
    return this.request<{ automation: MogplexApiAutomation }>(
      `/api/v1/mogplex/automations/${encodeURIComponent(input.automationId)}`
    );
  }

  createAutomation(input: CreateMogplexApiAutomationInput) {
    return this.request<{ automation: MogplexApiAutomation }>(
      "/api/v1/mogplex/automations",
      { method: "POST", body: input }
    );
  }

  updateAutomation(
    input: UpdateMogplexApiAutomationInput & { automationId: string }
  ) {
    const { automationId, ...body } = input;
    return this.request<{ automation: MogplexApiAutomation }>(
      `/api/v1/mogplex/automations/${encodeURIComponent(automationId)}`,
      { method: "PUT", body }
    );
  }

  publishAutomation(input: { automationId: string }) {
    return this.request<{ automation: MogplexApiAutomation }>(
      `/api/v1/mogplex/automations/${encodeURIComponent(input.automationId)}/publish`,
      { method: "POST" }
    );
  }

  setAutomationModel(input: {
    automationId: string;
    nodeId: string;
    modelId: string | null;
    publish?: boolean;
  }) {
    const { automationId, ...body } = input;
    return this.request<{ automation: MogplexApiAutomation }>(
      `/api/v1/mogplex/automations/${encodeURIComponent(automationId)}/model`,
      { method: "PUT", body }
    );
  }

  triggerAutomation(input: {
    automationId: string;
    repoId: string;
    input?: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const { automationId, idempotencyKey, ...body } = input;
    return this.request<{
      run: {
        automationId: string;
        jobRunId: string | null;
        outcome: string;
        reason: string | null;
        started: boolean;
        status: string | null;
        runtime: { provider: string | null; runId: string | null } | null;
      };
    }>(
      `/api/v1/mogplex/automations/${encodeURIComponent(automationId)}/trigger`,
      { method: "POST", body, idempotencyKey }
    );
  }

  listAutomationRuns(input: { automationId: string; limit?: number }) {
    return this.request<{ runs: FlowRunRecord[] }>(
      `/api/v1/mogplex/automations/${encodeURIComponent(input.automationId)}/runs`,
      { query: { limit: input.limit } }
    );
  }

  getAutomationRunLogs(input: { automationId: string; runId: string }) {
    return this.request<{ run: FlowRunDetail }>(
      `/api/v1/mogplex/automations/${encodeURIComponent(input.automationId)}/runs/${encodeURIComponent(input.runId)}`
    );
  }

  rerunPrReview(input: { repoId: string; prNumber: number }) {
    return this.request<RerunMogplexPrReviewResult>(
      "/api/v1/mogplex/pr-reviews/rerun",
      { method: "POST", body: input }
    );
  }

  startAgentRun(input: StartMogplexApiAgentRunInput) {
    const { idempotencyKey, ...body } = input;
    return this.request<StartMogplexApiAgentRunResult>("/api/v1/mogplex/runs", {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  getRun(input: { runId: string }) {
    return this.request<{ run: MogplexApiRunDetail }>(
      `/api/v1/mogplex/runs/${encodeURIComponent(input.runId)}`
    );
  }

  getRunEvents(input: { runId: string; limit?: number }) {
    return this.request<MogplexApiRunEventsResult>(
      `/api/v1/mogplex/runs/${encodeURIComponent(input.runId)}/events`,
      {
        query: {
          limit: input.limit,
        },
      }
    );
  }

  cancelRun(input: { runId: string }) {
    return this.request<MogplexApiRunCancelResult>(
      `/api/v1/mogplex/runs/${encodeURIComponent(input.runId)}/cancel`,
      {
        method: "POST",
      }
    );
  }
}
