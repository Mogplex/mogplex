import type { syncGithubWebhookState } from "@/lib/github-webhook-sync";
import type { enqueueAutomationJobRun } from "@/lib/automation-dispatch";
import type { TriggerFilterAccountType } from "@/lib/flows/trigger-filter";
import type { TriggerEvent } from "@/lib/types";
import type { GithubRepoPayload } from "@/lib/github-sync";

export const BOT_LOGIN = "mogplex[bot]";

// Loop-breaker backstop: cap how many `mention` runs a single PR/issue can
// queue within a rolling window, in case the marker-based self-loop guard is
// ever bypassed. Bounds a worst-case runaway to MENTION_LOOP_MAX runs.
export const MENTION_LOOP_WINDOW_MINUTES = 10;
export const MENTION_LOOP_MAX = 3;

export type EventResult = {
  assignmentType: string;
  triggerEvent?: TriggerEvent;
  metadata: Record<string, unknown>;
  agentSlug?: string | null;
  authorLogin?: string | null;
  authorIsBot?: boolean | null;
};

export type WebhookRepoRow = {
  id: string;
  user_id: string;
  full_name?: string | null;
  github_installation_id?: number | null;
  product_team_id?: string | null;
  root_directory?: string | null;
  parent_repo_id?: string | null;
  webhook_secret?: string | null;
};

export type WebhookFlowRow = {
  id: string;
  user_id: string;
  installation_id: number;
  published_version_id: string;
  published_version:
    | {
        id: string;
        graph: unknown;
      }
    | Array<{
        id: string;
        graph: unknown;
      }>
    | null;
};

// Flows are the only dispatch shape a webhook produces. The assignment and
// trigger arms are gone: both built a run straight from the agent row, so they
// executed `agents.model` with no node able to override it. The node is now the
// only source of a step's model, and only a flow has nodes.
export type PendingWebhookJob = {
  userId: string;
  flow_id?: string | null;
  flow_version_id?: string | null;
  status: "pending";
  metadata: Record<string, unknown>;
  idempotency_key: string;
  scope: {
    sourceKind: "flow";
    sourceType: string;
    sourceId: string;
    repoId: string | null;
    installationId: number | null;
  };
};

export type WebhookSyncResult = Awaited<
  ReturnType<typeof syncGithubWebhookState>
>;

export type EnqueuedWebhookJob = Awaited<
  ReturnType<typeof enqueueAutomationJobRun>
> & {
  scope: PendingWebhookJob["scope"];
  flowId: string | null;
  flowVersionId: string | null;
};

export type StartedWebhookJob = {
  started: boolean;
  deferred: boolean;
  runtimeProvider: string | null;
  runtimeRunId: string | null;
  workflowRunId: string | null;
  status: string | null;
  reason: string | null;
  error: string | null;
};

export type WebhookInstallation = {
  id?: number;
  account?: {
    login?: string;
    type?: string;
  };
  target_type?: string;
  permissions?: Record<string, string>;
};

export type WebhookPayloadBody = Record<string, unknown> & {
  action?: string;
  sender?: { login?: string; type?: string };
  installation?: WebhookInstallation;
  repository?: GithubRepoPayload;
  repositories_added?: GithubRepoPayload[];
  repositories_removed?: Array<{ id: number }>;
};

export type WebhookRequestContext = {
  event: string | null;
  deliveryId: string | null;
  signature: string;
  globalSecret: string | null;
  payload: string;
  body: WebhookPayloadBody;
  installationId: number | null;
  repoGithubId: number | null;
  repoFullName: string | null;
  accountType: TriggerFilterAccountType;
};

export type WebhookCheckRunBody = {
  id?: number;
  external_id?: string | null;
  name?: string | null;
  head_sha?: string | null;
  details_url?: string | null;
};

export type WebhookRequestedAction = {
  identifier?: string | null;
};

export type CheckRunRetryContextMatchInput = {
  repoRows: WebhookRepoRow[];
  repoId: string | null;
  installationId: number | null;
  webhookInstallationId: number | null;
};

export type RawWebhookRequestContext = Pick<
  WebhookRequestContext,
  "event" | "deliveryId" | "signature" | "globalSecret" | "payload"
>;
