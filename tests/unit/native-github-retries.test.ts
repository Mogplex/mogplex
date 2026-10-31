import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrOpenedFlowFixture,
  loadGithubWebhookRoute,
} from "./helpers/github-webhook-route-fixtures";

for (const kind of ["mention", "labeled"] as const) {
  test(`native ${kind} retries preserve independent job admission`, async (t) => {
    const originalFetch = globalThis.fetch;
    const backend = process.env.MOGPLEX_DATA_BACKEND;
    process.env.MOGPLEX_DATA_BACKEND = "supabase";
    await loadGithubWebhookRoute();
    t.mock.method(console, "error", () => {});
    try {
      const { handleNativeGithubWebhook } =
        await import("../../app/api/webhooks/github/_lib/native-handler");
      const flow = { ...buildPrOpenedFlowFixture(null), installation_id: 99 };
      flow.published_version.graph.nodes[0].data.event = kind;
      const created = new Map<string, string>();
      let claims = 0;
      let enqueues = 0;
      let suppressions = 0;
      let status = "pending";
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/repos"))
          return Response.json([
            {
              id: "repo-1",
              user_id: "user-a",
              full_name: "acme/web",
              github_installation_id: 99,
            },
          ]);
        if (url.pathname.endsWith("/flows")) return Response.json([flow]);
        if (url.pathname.endsWith("/agents"))
          return Response.json([{ id: "agent-1", slug: "reviewer" }]);
        if (url.pathname.endsWith("/automation_dispatch_events")) {
          if (init?.method === "POST") {
            suppressions++;
            return Response.json(null);
          }
          const excluded =
            url.searchParams.get("metadata") ===
            'not.cs.{"github_delivery_id":"delivery-stable"}';
          const count = 2 + (excluded ? 0 : created.size);
          return new Response(null, {
            headers: { "content-range": `0-0/${count}` },
          });
        }
        if (url.pathname.endsWith("/rpc/enqueue_automation_job_run")) {
          const body = JSON.parse(String(init?.body)) as {
            p_idempotency_key: string;
            p_metadata: Record<string, unknown>;
          };
          enqueues++;
          assert.equal(body.p_metadata.github_delivery_id, "delivery-stable");
          const existing = created.get(body.p_idempotency_key);
          const id = existing ?? "job-1";
          created.set(body.p_idempotency_key, id);
          return Response.json([
            {
              job_run_id: id,
              outcome: existing ? "suppressed" : "queued",
              reason: existing ? "IDEMPOTENT_DUPLICATE" : null,
            },
          ]);
        }
        if (url.pathname.endsWith("/job_runs"))
          return Response.json({ id: "job-1", status, metadata: {} });
        if (url.pathname.endsWith("/rpc/record_job_run_start_attempt"))
          return Response.json([{ found: true }]);
        if (url.pathname.endsWith("/rpc/claim_automation_job_run")) {
          claims++;
          if (kind === "mention" && claims === 1)
            return Response.json(
              { message: "temporary admission failure" },
              { status: 400 }
            );
          status = "running";
          return Response.json([{ claimed: false, status }]);
        }
        if (url.pathname.endsWith("/flow_waits")) {
          if ((init?.method ?? "GET") === "GET")
            return Response.json([
              {
                id: "wait-1",
                user_id: "user-a",
                job_run_id: "waiting-job",
                flow_id: "flow-1",
                installation_id: 99,
                repo_id: "repo-1",
                node_id: "await",
                resume_token: "invalid-token",
                wait_kind: "github_label_added",
                wait_config: {
                  kind: "github_label_added",
                  labelName: "ready",
                  prOnly: false,
                },
              },
            ]);
          const body = JSON.parse(String(init?.body)) as { status: string };
          return body.status === "resumed"
            ? Response.json({ resume_token: "invalid-token" })
            : new Response(null, { status: 204 });
        }
        if (url.pathname.includes("/waitpoints/tokens/"))
          return Response.json(
            { error: "permanent token rejection" },
            { status: 400 }
          );
        throw new Error(`Unexpected external request ${url.pathname}`);
      };
      const event = {
        installation: { id: 99 },
        repository: { id: 42, full_name: "acme/web" },
        action: kind === "mention" ? "created" : "labeled",
        label: { name: "ready" },
        issue: {
          number: 7,
          title: "Fixture",
          html_url: "https://github.test/acme/web/issues/7",
        },
        pull_request: {
          number: 7,
          html_url: "https://github.test/acme/web/pull/7",
        },
        comment: {
          id: 9,
          body: "@mogplex please review",
          html_url: "https://github.test/acme/web/issues/7#comment-9",
          user: { login: "human", type: "User" },
        },
      };
      const headers = new Headers({
        "x-github-event": kind === "mention" ? "issue_comment" : "pull_request",
        "x-github-delivery": "delivery-stable",
      });
      if (kind === "mention") {
        await assert.rejects(
          handleNativeGithubWebhook(event, headers),
          /dispatch failed/
        );
        await handleNativeGithubWebhook(event, headers);
        assert.equal(
          claims,
          2,
          "retry must reach atomic start admission for its existing pending mention"
        );
      } else {
        for (let attempt = 0; attempt < 2; attempt++)
          await assert.rejects(
            handleNativeGithubWebhook(event, headers),
            /wait routing failed/
          );
        assert.equal(
          claims,
          1,
          "independent jobs start even while a wait keeps failing"
        );
      }
      assert.equal(enqueues, 2);
      assert.equal(created.size, 1);
      assert.equal(
        suppressions,
        0,
        "the current delivery must not trip its own loop breaker"
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (backend === undefined) delete process.env.MOGPLEX_DATA_BACKEND;
      else process.env.MOGPLEX_DATA_BACKEND = backend;
    }
  });
}

test("native check-run cross-repository rejection stops retries without starting work", async () => {
  const originalFetch = globalThis.fetch;
  const backend = process.env.MOGPLEX_DATA_BACKEND;
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  await loadGithubWebhookRoute();
  try {
    const { handleNativeGithubWebhook } =
      await import("../../app/api/webhooks/github/_lib/native-handler");
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/repos"))
        return url.searchParams.has("github_id")
          ? Response.json([{ id: "repo-current", github_installation_id: 99 }])
          : Response.json({
              id: "repo-other",
              user_id: "other-user",
              github_installation_id: 100,
            });
      if (url.pathname.endsWith("/job_runs"))
        return Response.json({
          id: "job-other",
          assignment_id: "assignment-other",
          trigger_id: null,
          flow_id: null,
          flow_version_id: null,
          metadata: {},
        });
      if (url.pathname.endsWith("/assignments"))
        return Response.json({
          id: "assignment-other",
          repo_id: "repo-other",
          type: "pr_review",
        });
      assert.fail(
        `rejected retry must not start or enqueue work: ${url.pathname}`
      );
    };
    await assert.rejects(
      handleNativeGithubWebhook(
        {
          installation: { id: 99 },
          repository: { id: 42, full_name: "acme/web" },
          action: "rerequested",
          check_run: {
            id: 7,
            name: "Mogplex PR Review",
            external_id: "job-other",
          },
        },
        new Headers({
          "x-github-event": "check_run",
          "x-github-delivery": "delivery-stable",
        })
      ),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "AbortTaskRunError");
        assert.match(error.message, /rejected/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (backend === undefined) delete process.env.MOGPLEX_DATA_BACKEND;
    else process.env.MOGPLEX_DATA_BACKEND = backend;
  }
});
