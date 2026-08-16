import assert from "node:assert/strict";
import test from "node:test";
import type { JobContext } from "../../lib/workflows/automation-job-types";

function makePrContext(metadata?: Record<string, unknown>): JobContext {
  return {
    metadata: metadata ?? {
      pr_number: 42,
      head_ref: "dependabot/npm_and_yarn/left-pad-1.0.0",
    },
    assignmentType: "pr_review",
    skillId: null,
    agent: { model: "openai/gpt-5.4", system_prompt: null },
    repo: {
      id: "repo-123",
      user_id: "user-123",
      full_name: "acme/widgets",
      github_installation_id: 123,
    },
  };
}

async function loadLivenessModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/workflows/automation-job-pr-liveness");
}

async function loadFetchPrLiveness() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const mod = await import("../../lib/workflows/automation-job-github");
  return mod.fetchPrLiveness;
}

function withMockedFetch(
  handler: (url: string) => Response,
  run: () => Promise<void>
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return handler(url);
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

const PR_URL = "https://api.github.com/repos/acme/widgets/pulls/42";
const BRANCH_URL = `https://api.github.com/repos/acme/widgets/branches/${encodeURIComponent("dependabot/npm_and_yarn/left-pad-1.0.0")}`;

const livenessInput = {
  githubToken: "review-token",
  baseRepoFullName: "acme/widgets",
  headRepoFullName: "acme/widgets",
  prNumber: 42,
  headRef: "dependabot/npm_and_yarn/left-pad-1.0.0",
};

test("checkAutomationPrLiveness returns alive for non-PR jobs without calling fetchPrLiveness", async () => {
  const { checkAutomationPrLiveness } = await loadLivenessModule();

  const result = await checkAutomationPrLiveness({
    context: makePrContext({ source_type: "assignment" }),
    githubToken: "review-token",
    fetchPrLiveness: async () => {
      throw new Error("fetchPrLiveness should not be called");
    },
  });

  assert.deepEqual(result, { alive: true });
});

test("checkAutomationPrLiveness fails open when fetchPrLiveness throws", async () => {
  const { checkAutomationPrLiveness } = await loadLivenessModule();

  const result = await checkAutomationPrLiveness({
    context: makePrContext(),
    githubToken: "review-token",
    fetchPrLiveness: async () => {
      throw new Error("network unreachable");
    },
  });

  assert.deepEqual(result, { alive: true });
});

test("checkAutomationPrLiveness passes through a dead-PR result", async () => {
  const { checkAutomationPrLiveness } = await loadLivenessModule();

  const result = await checkAutomationPrLiveness({
    context: makePrContext(),
    githubToken: "review-token",
    fetchPrLiveness: async (input) => {
      assert.equal(input.baseRepoFullName, "acme/widgets");
      assert.equal(input.headRepoFullName, "acme/widgets");
      assert.equal(input.prNumber, 42);
      assert.equal(input.headRef, "dependabot/npm_and_yarn/left-pad-1.0.0");
      return { alive: false, reason: "pr_closed" };
    },
  });

  assert.deepEqual(result, { alive: false, reason: "pr_closed" });
});

test("fetchPrLiveness reports pr_closed when the PR lookup 404s", async () => {
  const fetchPrLiveness = await loadFetchPrLiveness();

  await withMockedFetch(
    (url) => {
      assert.equal(url, PR_URL);
      return new Response("Not Found", { status: 404 });
    },
    async () => {
      assert.deepEqual(await fetchPrLiveness(livenessInput), {
        alive: false,
        reason: "pr_closed",
      });
    }
  );
});

test("fetchPrLiveness reports pr_closed when the PR state is not open", async () => {
  const fetchPrLiveness = await loadFetchPrLiveness();

  await withMockedFetch(
    (url) => {
      assert.equal(url, PR_URL);
      return Response.json({ state: "closed" }, { status: 200 });
    },
    async () => {
      assert.deepEqual(await fetchPrLiveness(livenessInput), {
        alive: false,
        reason: "pr_closed",
      });
    }
  );
});

test("fetchPrLiveness fails open when a 200 PR body cannot be parsed", async () => {
  const fetchPrLiveness = await loadFetchPrLiveness();

  await withMockedFetch(
    (url) => {
      assert.equal(url, PR_URL);
      return new Response("<<<garbled", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    async () => {
      assert.deepEqual(await fetchPrLiveness(livenessInput), { alive: true });
    }
  );
});

test("fetchPrLiveness reports head_branch_deleted when an open PR loses its head branch", async () => {
  const fetchPrLiveness = await loadFetchPrLiveness();

  await withMockedFetch(
    (url) => {
      if (url === PR_URL) {
        return Response.json({ state: "open" }, { status: 200 });
      }
      assert.equal(url, BRANCH_URL);
      return new Response("Not Found", { status: 404 });
    },
    async () => {
      assert.deepEqual(await fetchPrLiveness(livenessInput), {
        alive: false,
        reason: "head_branch_deleted",
      });
    }
  );
});

test("fetchPrLiveness reports alive when the PR is open and the head branch exists", async () => {
  const fetchPrLiveness = await loadFetchPrLiveness();

  await withMockedFetch(
    (url) => {
      if (url === PR_URL) {
        return Response.json({ state: "open" }, { status: 200 });
      }
      assert.equal(url, BRANCH_URL);
      return Response.json({ name: "dependabot/npm_and_yarn/left-pad-1.0.0" });
    },
    async () => {
      assert.deepEqual(await fetchPrLiveness(livenessInput), { alive: true });
    }
  );
});

test("fetchPrLiveness fails open on GitHub 5xx responses", async () => {
  const fetchPrLiveness = await loadFetchPrLiveness();

  await withMockedFetch(
    (url) => {
      assert.equal(url, PR_URL);
      return new Response("Server Error", { status: 502 });
    },
    async () => {
      assert.deepEqual(await fetchPrLiveness(livenessInput), { alive: true });
    }
  );

  await withMockedFetch(
    (url) => {
      if (url === PR_URL) {
        return Response.json({ state: "open" }, { status: 200 });
      }
      assert.equal(url, BRANCH_URL);
      return new Response("Server Error", { status: 500 });
    },
    async () => {
      assert.deepEqual(await fetchPrLiveness(livenessInput), { alive: true });
    }
  );
});
