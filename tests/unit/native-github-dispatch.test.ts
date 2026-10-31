import assert from "node:assert/strict";
import test from "node:test";
import {
  loadGithubWebhookRoute,
  buildPrOpenedFlowFixture,
} from "./helpers/github-webhook-route-fixtures";

const headers = (event: string) =>
  new Headers({
    "x-github-event": event,
    "x-github-delivery": "delivery-stable",
  });
const base = {
  installation: { id: 99, target_type: "Organization" },
  repository: { id: 42, full_name: "acme/web" },
};
const repo = {
  id: "repo-1",
  user_id: "user-a",
  full_name: "acme/web",
  github_installation_id: 99,
};

async function withTransport(run: () => Promise<void>) {
  const oldBackend = process.env.MOGPLEX_DATA_BACKEND;
  const oldSecret = process.env.TRIGGER_SECRET_KEY;
  process.env.TRIGGER_SECRET_KEY = "tr_dev_synthetic_native_webhook_test";
  const originalFetch = globalThis.fetch;
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  await loadGithubWebhookRoute();
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (oldSecret === undefined) delete process.env.TRIGGER_SECRET_KEY;
    else process.env.TRIGGER_SECRET_KEY = oldSecret;
    if (oldBackend === undefined) delete process.env.MOGPLEX_DATA_BACKEND;
    else process.env.MOGPLEX_DATA_BACKEND = oldBackend;
  }
}

test("native GitHub retries partial enqueue without creating a second successful domain job", async () => {
  await withTransport(async () => {
    const { handleNativeGithubWebhook } =
      await import("../../app/api/webhooks/github/_lib/native-handler");
    const flows = ["flow-a", "flow-b"].map((id) => ({
      ...buildPrOpenedFlowFixture(null),
      id,
      installation_id: 99,
    }));
    const created = new Map<string, string>();
    let failSecond = true;
    let starts = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/repos")) {
        assert.equal(url.searchParams.get("github_installation_id"), "eq.99");
        return Response.json([repo]);
      }
      if (url.pathname.endsWith("/flows")) return Response.json(flows);
      if (url.pathname.endsWith("/agents"))
        return Response.json([{ id: "agent-1", slug: "reviewer" }]);
      if (url.pathname.endsWith("/rpc/enqueue_automation_job_run")) {
        const payload = JSON.parse(String(init?.body)) as {
          p_flow_id: string;
          p_idempotency_key: string;
        };
        if (payload.p_flow_id === "flow-b" && failSecond) {
          failSecond = false;
          return Response.json(
            { message: "temporary database failure" },
            { status: 400 }
          );
        }
        const existing = created.get(payload.p_idempotency_key);
        const id = existing ?? `job-${created.size + 1}`;
        created.set(payload.p_idempotency_key, id);
        return Response.json([
          {
            job_run_id: id,
            outcome: existing ? "suppressed" : "queued",
            reason: existing ? "IDEMPOTENT_DUPLICATE" : null,
          },
        ]);
      }
      if (url.pathname.endsWith("/job_runs")) {
        // The successful job is already running by the time the retry arrives.
        return Response.json({
          id: url.searchParams.get("id")?.slice(3),
          status: "running",
        });
      }
      if (url.pathname.endsWith("/rpc/record_job_run_start_attempt")) {
        return Response.json([{ found: true }]);
      }
      if (url.pathname.endsWith("/rpc/claim_automation_job_run")) starts++;
      throw new Error(`Unexpected request ${url.pathname}`);
    };
    const event = {
      ...base,
      action: "opened",
      pull_request: {
        number: 7,
        html_url: "https://github.test/acme/web/pull/7",
      },
    };
    await assert.rejects(
      handleNativeGithubWebhook(event, headers("pull_request")),
      /dispatch failed/
    );
    assert.equal(created.size, 1);
    await handleNativeGithubWebhook(event, headers("pull_request"));
    assert.equal(created.size, 2);
    assert.equal(
      starts,
      0,
      "a previously running job must not be claimed again"
    );
    assert.ok(
      [...created.keys()].every((key) => key.endsWith(":delivery-stable"))
    );
  });
});

test("native GitHub retries an existing pending duplicate through atomic start admission", async () => {
  await withTransport(async () => {
    const { handleNativeGithubWebhook } =
      await import("../../app/api/webhooks/github/_lib/native-handler");
    const flow = {
      ...buildPrOpenedFlowFixture(null),
      id: "flow-a",
      installation_id: 99,
    };
    let jobStatus = "pending";
    let durableJobs = 1;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/repos")) return Response.json([repo]);
      if (url.pathname.endsWith("/flows")) return Response.json([flow]);
      if (url.pathname.endsWith("/agents"))
        return Response.json([{ id: "agent-1", slug: "reviewer" }]);
      if (url.pathname.endsWith("/rpc/enqueue_automation_job_run")) {
        return Response.json([
          {
            job_run_id: "existing-pending-job",
            outcome: "suppressed",
            reason: "IDEMPOTENT_DUPLICATE",
          },
        ]);
      }
      if (url.pathname.endsWith("/job_runs")) {
        return Response.json({
          id: "existing-pending-job",
          status: jobStatus,
          metadata: {},
        });
      }
      if (url.pathname.endsWith("/rpc/record_job_run_start_attempt"))
        return Response.json([{ found: true }]);
      if (url.pathname.endsWith("/rpc/claim_automation_job_run")) {
        // An overlapping dispatcher wins the atomic claim. Native admission
        // must reach this guard, and must not start a second copy afterwards.
        jobStatus = "running";
        return Response.json([{ claimed: false, status: jobStatus }]);
      }
      if (url.pathname.includes("/tasks/")) durableJobs++;
      throw new Error(`Unexpected request ${url.pathname}`);
    };
    await handleNativeGithubWebhook(
      {
        ...base,
        action: "opened",
        pull_request: {
          number: 7,
          html_url: "https://github.test/acme/web/pull/7",
        },
      },
      headers("pull_request")
    );
    assert.equal(
      jobStatus,
      "running",
      "a delivery retry must not strand its already-enqueued pending job"
    );
    assert.equal(
      durableJobs,
      1,
      "the start guard must preserve the one existing job"
    );
  });
});

for (const rollbackFails of [false, true]) {
  test(`native GitHub ${rollbackFails ? "stops visibly after a stranded rollback" : "retries only uncompleted waits after a partial failure"}`, async () => {
    await withTransport(async () => {
      const { handleNativeGithubWebhook } =
        await import("../../app/api/webhooks/github/_lib/native-handler");
      const statuses = new Map([
        ["wait-a", "waiting"],
        ["wait-b", "waiting"],
      ]);
      const completed: string[] = [];
      let failSecond = true;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.includes("/waitpoints/tokens/")) {
          const token = url.pathname.split("/").at(-2) ?? "";
          if (token === "token-wait-b" && failSecond) {
            failSecond = false;
            return Response.json(
              { error: "completion unavailable" },
              { status: 400 }
            );
          }
          completed.push(token);
          return Response.json({ success: true });
        }
        if (url.pathname.endsWith("/repos")) return Response.json([repo]);
        if (url.pathname.endsWith("/flows")) return Response.json([]);
        if (url.pathname.endsWith("/flow_waits")) {
          if ((init?.method ?? "GET") === "GET") {
            assert.equal(url.searchParams.get("installation_id"), "eq.99");
            return Response.json(
              [...statuses]
                .filter(([, status]) => status === "waiting")
                .map(([id]) => ({
                  id,
                  user_id: "user-a",
                  job_run_id: "job-1",
                  flow_id: "flow-1",
                  installation_id: 99,
                  repo_id: "repo-1",
                  node_id: "await",
                  wait_kind: "github_label_added",
                  wait_config: {
                    kind: "github_label_added",
                    labelName: "ready",
                    prOnly: false,
                  },
                  resume_token: `token-${id}`,
                }))
            );
          }
          const id = url.searchParams.get("id")?.slice(3) ?? "";
          const body = JSON.parse(String(init?.body)) as { status: string };
          if (body.status === "waiting" && rollbackFails) {
            return Response.json(
              { message: "rollback unavailable" },
              { status: 400 }
            );
          }
          statuses.set(id, body.status);
          return body.status === "resumed"
            ? Response.json({ resume_token: `token-${id}` })
            : new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected request ${url.pathname}`);
      };
      {
        const event = {
          ...base,
          action: "labeled",
          label: { name: "ready" },
          pull_request: { number: 7 },
        };
        if (rollbackFails) {
          await assert.rejects(
            handleNativeGithubWebhook(event, headers("pull_request")),
            (error) => {
              assert.ok(error instanceof Error);
              assert.equal(error.name, "AbortTaskRunError");
              assert.match(error.message, /operator repair/);
              return true;
            }
          );
          assert.deepEqual(completed, ["token-wait-a"]);
          assert.equal(statuses.get("wait-b"), "resumed");
          return;
        }
        await assert.rejects(
          handleNativeGithubWebhook(event, headers("pull_request")),
          /wait routing failed/
        );
        assert.deepEqual(completed, ["token-wait-a"]);
        assert.equal(statuses.get("wait-b"), "waiting");
        await handleNativeGithubWebhook(event, headers("pull_request"));
        assert.deepEqual(completed, ["token-wait-a", "token-wait-b"]);
      }
    });
  });
}

test("native GitHub rejects malformed identity and never broadens a missing installation into another tenant", async () => {
  await withTransport(async () => {
    const { handleNativeGithubWebhook } =
      await import("../../app/api/webhooks/github/_lib/native-handler");
    let lookups = 0;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      lookups++;
      if (url.pathname.endsWith("/repos")) {
        assert.equal(url.searchParams.get("github_installation_id"), "eq.100");
        return Response.json([]);
      }
      if (url.pathname.endsWith("/github_installations")) {
        assert.equal(url.searchParams.get("installation_id"), "eq.100");
        return Response.json([]);
      }
      throw new Error(`Cross-tenant or unexpected query ${url.pathname}`);
    };
    await assert.rejects(
      handleNativeGithubWebhook(
        { repository: base.repository },
        headers("pull_request")
      ),
      /Invalid GitHub webhook identity/
    );
    assert.equal(lookups, 0);
    await handleNativeGithubWebhook(
      {
        ...base,
        installation: { id: 100 },
        action: "opened",
        pull_request: {
          number: 7,
          html_url: "https://github.test/acme/web/pull/7",
        },
      },
      headers("pull_request")
    );
    assert.equal(lookups, 2);
  });
});

for (const failingTable of ["repos", "flows", "agents", "flow_waits"]) {
  test(`native ${failingTable} schema failures retain the existing stop-retry classification`, async () => {
    await withTransport(async () => {
      const { handleNativeGithubWebhook } =
        await import("../../app/api/webhooks/github/_lib/native-handler");
      const { isSchemaDriftError, SCHEMA_DRIFT_MESSAGE } = await import("../../lib/schema-drift");
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/${failingTable}`)) {
          return Response.json(
            { code: "42703", message: failingTable === "flow_waits" ? SCHEMA_DRIFT_MESSAGE : "fixture column is missing" },
            { status: 400 }
          );
        }
        if (url.pathname.endsWith("/repos")) return Response.json([repo]);
        if (url.pathname.endsWith("/flows"))
          return Response.json([
            { ...buildPrOpenedFlowFixture(null), installation_id: 99 },
          ]);
        throw new Error(
          `Schema failure must stop before further effects: ${url.pathname}`
        );
      };
      await assert.rejects(
        handleNativeGithubWebhook(
          {
            ...base,
            action: failingTable === "flow_waits" ? "labeled" : "opened",
            label: { name: "ready" },
            pull_request: {
              number: 7,
              html_url: "https://github.test/acme/web/pull/7",
            },
          },
          headers("pull_request")
        ),
        (error) => isSchemaDriftError(error)
      );
    });
  });
}
