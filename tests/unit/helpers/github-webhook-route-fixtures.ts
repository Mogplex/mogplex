/**
 * Shared fixtures and helpers for github-webhook-route tests.
 */

import type { TriggerEvent } from "../../../lib/types";

export async function loadGithubWebhookRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/webhooks/github/route");
}

export type DualReadLog = {
  event: string;
  flows_id_matched: number;
  flows_filter_matched: number;
  flows_no_filter: number;
  diff_flow_ids: string[];
  installation_id: number;
  account_type: "User" | "Organization";
};

export function captureDualReadLogs(run: () => unknown): DualReadLog[] {
  const original = console.log;
  const logs: DualReadLog[] = [];
  console.log = (message: unknown) => {
    if (typeof message !== "string") return;
    try {
      const parsed = JSON.parse(message) as DualReadLog;
      if (parsed.event === "flow_routing_dual_read") logs.push(parsed);
    } catch {
      /* ignore non-JSON log lines */
    }
  };
  try {
    run();
  } finally {
    console.log = original;
  }
  return logs;
}

export function buildPrOpenedFlowFixture(filter: unknown) {
  return {
    id: "flow-1",
    user_id: "user-a",
    installation_id: 117860437,
    published_version_id: "version-1",
    published_version: {
      id: "version-1",
      graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: { label: "PR opened", event: "pr_opened", filter },
          },
          {
            id: "agent-1",
            type: "agent",
            position: { x: 100, y: 0 },
            data: { label: "Reviewer", agentId: "agent-1" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 200, y: 0 },
            data: { label: "Done" },
          },
        ],
        edges: [
          { id: "start-agent", source: "start", target: "agent-1" },
          { id: "agent-end", source: "agent-1", target: "end" },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
  };
}

export const PR_OPENED_RESULT = {
  assignmentType: "pr_review",
  triggerEvent: "pr_opened" as const,
  metadata: { pr_number: 1, pr_url: "https://github.com/acme/web/pull/1" },
};

export const REPO_FIXTURE = [
  {
    id: "repo-user-a",
    user_id: "user-a",
    full_name: "acme/web",
    root_directory: null,
    parent_repo_id: null,
  },
];

export function buildLabeledFlowGraph(startData: Record<string, unknown>) {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Label added", event: "labeled", ...startData },
      },
      {
        id: "agent-1",
        type: "agent",
        position: { x: 100, y: 0 },
        data: { label: "Reviewer", agentId: "agent-1" },
      },
      {
        id: "end",
        type: "end",
        position: { x: 200, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-agent", source: "start", target: "agent-1" },
      { id: "agent-end", source: "agent-1", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function buildLabeledFlowInput(
  startData: Record<string, unknown>,
  result: {
    assignmentType: string;
    triggerEvent: TriggerEvent;
    metadata: Record<string, unknown>;
  }
) {
  return {
    flows: [
      {
        id: "flow-labeled",
        user_id: "user-a",
        installation_id: 117860437,
        published_version_id: "version-labeled",
        published_version: {
          id: "version-labeled",
          graph: buildLabeledFlowGraph(startData),
        },
      },
    ],
    results: [result],
    repoRows: [
      {
        id: "repo-user-a",
        user_id: "user-a",
        full_name: "webrenew/mogplex-tui",
        root_directory: null,
        parent_repo_id: null,
      },
    ],
    payload: '{"action":"labeled"}',
    deliveryId: "delivery-labeled",
    repoFullName: "webrenew/mogplex-tui",
    agentSlugsById: new Map([["agent-1", "reviewer"]]),
  };
}

export function buildCheckRunRetryResponseInput(
  deliveryId = "delivery-rerun-1"
) {
  return {
    context: {
      event: "check_run",
      deliveryId,
      signature: "sha256=test",
      globalSecret: null,
      payload: JSON.stringify({ deliveryId }),
      body: {
        action: "requested_action",
        requested_action: { identifier: "rerun-pr-review" },
        check_run: {
          id: 91,
          name: "Mogplex PR Review",
          external_id: "job-1",
        },
      },
      installationId: 117860437,
      repoGithubId: 42,
      repoFullName: "webrenew/credit-renew",
      accountType: "Organization" as const,
    },
    repoRows: [
      {
        id: "repo-1",
        user_id: "user-1",
        github_installation_id: 117860437,
      },
    ],
    sync: {} as never,
  };
}

export function buildCheckRunRetryContext() {
  return {
    run: {
      id: "job-1",
      flow_id: "flow-1",
      flow_version_id: "version-1",
    },
    userId: "user-1",
    sourceType: "pr_opened",
    assignmentId: null,
    triggerId: null,
    flowId: "flow-1",
    flowVersionId: "version-1",
    repoId: "repo-1",
    installationId: 117860437,
    metadata: null,
  } as never;
}
