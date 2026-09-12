import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { DEPENDABOT_ALERT_ACTIONS } from "../../lib/dependabot";
import {
  loadGithubWebhookRoute,
  REPO_FIXTURE,
} from "./helpers/github-webhook-route-fixtures";

const ALERT_PAYLOAD = {
  action: "created",
  alert: {
    number: 17,
    state: "open",
    html_url: "https://github.com/acme/web/security/dependabot/17",
    dependency: {
      package: { ecosystem: "npm", name: "minimist" },
      manifest_path: "pnpm-lock.yaml",
      scope: "runtime",
    },
    security_advisory: {
      ghsa_id: "GHSA-test-1234",
      cve_id: "CVE-2026-1234",
      severity: "high",
      identifiers: [
        { type: "GHSA", value: "GHSA-test-1234" },
        { type: "CVE", value: "CVE-2026-1234" },
      ],
    },
    security_vulnerability: {
      severity: "high",
      vulnerable_version_range: "< 1.2.8",
      first_patched_version: { identifier: "1.2.8" },
    },
  },
};

function flow(actions?: string[]) {
  return {
    id: "flow-dependabot",
    user_id: "user-a",
    installation_id: 117860437,
    published_version_id: "version-dependabot",
    published_version: {
      id: "version-dependabot",
      graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: {
              label: "Dependabot alert",
              event: "dependabot_alert",
              ...(actions ? { dependabotAlertActions: actions } : {}),
            },
          },
          {
            id: "agent",
            type: "agent",
            position: { x: 100, y: 0 },
            data: { label: "Remediator", agentId: "agent-1", role: "triage" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 200, y: 0 },
            data: { label: "Done" },
          },
        ],
        edges: [
          { id: "start-agent", source: "start", target: "agent" },
          { id: "agent-end", source: "agent", target: "end" },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
  };
}

function buildInput(
  result: import("../../app/api/webhooks/github/_lib/types").EventResult,
  actions?: string[]
) {
  return {
    flows: [flow(actions)],
    results: [result],
    repoRows: REPO_FIXTURE,
    payload: JSON.stringify(ALERT_PAYLOAD),
    deliveryId: "delivery-dependabot-1",
    repoFullName: "acme/web",
    installationId: 117860437,
    accountType: "Organization" as const,
    agentSlugsById: new Map([["agent-1", "remediator"]]),
  };
}

test("dependabot_alert.created is normalized with complete remediation metadata", async () => {
  const { getWebhookEventResults } = await loadGithubWebhookRoute();
  const [result] = getWebhookEventResults("dependabot_alert", ALERT_PAYLOAD);

  assert.equal(result.triggerEvent, "dependabot_alert");
  assert.equal(result.assignmentType, "dependabot_alert");
  assert.deepEqual(result.metadata, {
    webhook_action: "created",
    alert_number: 17,
    alert_state: "open",
    alert_url: "https://github.com/acme/web/security/dependabot/17",
    dependency_package: "minimist",
    dependency_ecosystem: "npm",
    manifest_path: "pnpm-lock.yaml",
    dependency_scope: "runtime",
    dependency_relationship: null,
    severity: "high",
    ghsa_id: "GHSA-test-1234",
    cve_id: "CVE-2026-1234",
    identifiers: [
      { type: "GHSA", value: "GHSA-test-1234" },
      { type: "CVE", value: "CVE-2026-1234" },
    ],
    cves: ["CVE-2026-1234"],
    vulnerable_version_range: "< 1.2.8",
    vulnerable_requirements: null,
    first_patched_version: "1.2.8",
    dismissed_at: null,
    dismissed_reason: null,
    dismissed_comment: null,
    dismissed_by: null,
    fixed_at: null,
    auto_dismissed_at: null,
  });
});

test("missing optional Dependabot alert fields are null-safe", async () => {
  const { getWebhookEventResults } = await loadGithubWebhookRoute();
  const [result] = getWebhookEventResults("dependabot_alert", {
    action: "created",
    alert: { number: 1, state: "open" },
  });

  assert.equal(result.metadata.dependency_package, null);
  assert.equal(result.metadata.first_patched_version, null);
  assert.deepEqual(result.metadata.identifiers, []);
  assert.deepEqual(result.metadata.cves, []);
  assert.deepEqual(
    getWebhookEventResults("dependabot_alert", { action: "unknown" }),
    []
  );
});

test("Dependabot lifecycle action filtering defaults safely to created", async () => {
  const { buildFlowWebhookJobs, getWebhookEventResults } =
    await loadGithubWebhookRoute();
  const [created] = getWebhookEventResults("dependabot_alert", ALERT_PAYLOAD);
  const [fixed] = getWebhookEventResults("dependabot_alert", {
    ...ALERT_PAYLOAD,
    action: "fixed",
  });

  assert.equal(buildFlowWebhookJobs(buildInput(created)).length, 1);
  assert.equal(buildFlowWebhookJobs(buildInput(fixed)).length, 0);
  assert.equal(buildFlowWebhookJobs(buildInput(fixed, ["fixed"])).length, 1);
  assert.equal(buildFlowWebhookJobs(buildInput(created, ["fixed"])).length, 0);
});

test("created alert jobs carry repository identity and have stable delivery idempotency", async () => {
  const { buildFlowWebhookJobs, getWebhookEventResults } =
    await loadGithubWebhookRoute();
  const [created] = getWebhookEventResults("dependabot_alert", ALERT_PAYLOAD);

  const first = buildFlowWebhookJobs(buildInput(created));
  const redelivery = buildFlowWebhookJobs(buildInput(created));

  assert.equal(first.length, 1);
  assert.equal(first[0].idempotency_key, redelivery[0].idempotency_key);
  assert.equal(first[0].metadata.repo_full_name, "acme/web");
  assert.equal(first[0].metadata.installation_id, 117860437);
  assert.equal(first[0].metadata.alert_number, 17);
});

test("every lifecycle action requires explicit selection and an empty list matches nothing", async () => {
  const { getWebhookEventResults, buildFlowWebhookJobs } =
    await loadGithubWebhookRoute();
  for (const action of DEPENDABOT_ALERT_ACTIONS) {
    const [event] = getWebhookEventResults("dependabot_alert", {
      ...ALERT_PAYLOAD,
      action,
    });
    assert.equal(
      buildFlowWebhookJobs(buildInput(event)).length,
      action === "created" ? 1 : 0
    );
    assert.equal(buildFlowWebhookJobs(buildInput(event, [action])).length, 1);
    assert.equal(buildFlowWebhookJobs(buildInput(event, [])).length, 0);
  }
});

test("signed Dependabot HTTP requests preserve authentication and the enqueue deduplication result", async () => {
  const oldSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const oldBackend = process.env.MOGPLEX_DATA_BACKEND;
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  process.env.GITHUB_WEBHOOK_SECRET = "dependabot-test-secret";
  const original = globalThis.fetch;
  const enqueues: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/repos")) return Response.json(REPO_FIXTURE);
    if (url.pathname.endsWith("/flows")) return Response.json([flow()]);
    if (url.pathname.endsWith("/agents"))
      return Response.json([{ id: "agent-1", slug: "remediator" }]);
    if (url.pathname.endsWith("/rpc/enqueue_automation_job_run")) {
      enqueues.push(JSON.parse(String(init?.body)));
      return Response.json([
        {
          job_run_id: "existing-job",
          outcome: "suppressed",
          reason: "IDEMPOTENT_DUPLICATE",
        },
      ]);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  try {
    const { POST } = await loadGithubWebhookRoute();
    const payload = JSON.stringify({
      ...ALERT_PAYLOAD,
      installation: { id: 117860437, target_type: "Organization" },
      repository: { id: 42, full_name: "acme/web" },
    });
    const request = (signature: string) =>
      new Request("http://localhost/api/webhooks/github", {
        method: "POST",
        body: payload,
        headers: {
          "x-github-event": "dependabot_alert",
          "x-github-delivery": "delivery-http",
          "x-hub-signature-256": signature,
        },
      });
    assert.equal((await POST(request("sha256=invalid"))).status, 401);
    assert.equal(enqueues.length, 0);
    const signature = `sha256=${createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(payload).digest("hex")}`;
    const response = await POST(request(signature));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.queued, 0);
    assert.equal(result.started, 0);
    assert.equal(result.suppressed, 1);
    assert.equal(enqueues.length, 1);
    assert.equal(enqueues[0].p_source_type, "dependabot_alert");
    assert.equal(
      (enqueues[0].p_metadata as Record<string, unknown>).alert_number,
      17
    );
    assert.ok(String(enqueues[0].p_idempotency_key).endsWith(":delivery-http"));
  } finally {
    globalThis.fetch = original;
    if (oldSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = oldSecret;
    if (oldBackend === undefined) delete process.env.MOGPLEX_DATA_BACKEND;
    else process.env.MOGPLEX_DATA_BACKEND = oldBackend;
  }
});
