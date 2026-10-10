import assert from "node:assert/strict";
import test from "node:test";

import { MogplexApiClient } from "../../lib/mogplex-api/client";
import { handleMogplexMcpPayload } from "../../lib/mogplex-api/mcp";
import {
  assertSingleMcpResponse,
  buildFakeMcpClient,
} from "./helpers/mogplex-api-mcp-fixtures";
import {
  buildUser,
  loadRunDetailRoute,
} from "./helpers/mogplex-api-runs-fixtures";

const automationId = "10000000-0000-4000-8000-000000000001";
const jobRunId = "20000000-0000-4000-8000-000000000002";
const branch = "mogplex/automation-0123456789abcdef";
const path = ".mogplex/artifacts/preview-test.json";
const commitSha = "c".repeat(40);

type SetupOptions = {
  owned?: boolean;
  status?: string;
  metadata?: Record<string, unknown> | null;
  githubToken?: string | null;
  providerFailure?: boolean;
  repositoryFailure?: boolean;
  scopes?: string[];
};

function providerFixtures(): [string, unknown][] {
  return [
    [
      `/commits/${encodeURIComponent(branch)}`,
      { sha: commitSha, commit: { tree: { sha: "root" } } },
    ],
    [
      "/trees/root",
      {
        tree: [{ path: ".mogplex", mode: "040000", type: "tree", sha: "dir" }],
      },
    ],
    [
      "/trees/dir",
      {
        tree: [
          { path: "artifacts", mode: "040000", type: "tree", sha: "artifacts" },
        ],
      },
    ],
    [
      "/trees/artifacts",
      {
        tree: [
          {
            path: "preview-test.json",
            mode: "100644",
            type: "blob",
            sha: "blob",
            size: 14,
          },
        ],
      },
    ],
    [
      "/blobs/blob",
      {
        encoding: "base64",
        size: 14,
        content: Buffer.from('{"ready":true}').toString("base64"),
      },
    ],
  ];
}

async function setup(options: SetupOptions = {}) {
  await loadRunDetailRoute();
  const { loadAutomationRunArtifact } =
    await import("../../lib/mogplex-api/automation-run-artifacts");
  const { RunArtifactError } =
    await import("../../lib/mogplex-api/run-artifacts");
  const { createAutomationRunArtifactGetHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/runs/[runId]/artifact/route");
  const urls: string[] = [];
  const jobRunLoads: unknown[] = [];
  const repoLoads: unknown[] = [];
  const handler = createAutomationRunArtifactGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { ...buildUser(), scopes: options.scopes ?? ["read", "write"] },
    }),
    loadArtifact: (input) =>
      loadAutomationRunArtifact(input, {
        loadJobRun: async (lookup) => {
          jobRunLoads.push(lookup);
          if (options.owned === false || lookup.userId !== "user-123")
            return null;
          return {
            status: options.status ?? "success",
            metadata:
              options.metadata === undefined
                ? { working_branch: branch, repo_id: "repo-1" }
                : options.metadata,
          };
        },
        loadRepo: async (repoId, userId) => {
          repoLoads.push({ repoId, userId });
          if (options.repositoryFailure)
            throw new TypeError("PRIVATE DATABASE DETAIL");
          return {
            repo: { user_id: "user-123", full_name: "webrenew/previews" },
            githubToken:
              options.githubToken === undefined
                ? "test-token"
                : options.githubToken,
          };
        },
        githubJson: async (_token, url) => {
          urls.push(url);
          if (options.providerFailure)
            throw new RunArtifactError(
              502,
              "Could not read the committed artifact"
            );
          const fixture = providerFixtures().find(([suffix]) =>
            url.endsWith(suffix)
          );
          if (fixture) return fixture[1];
          throw new Error("Unexpected GitHub URL");
        },
      }),
  });
  const request = (
    input: {
      artifactPath?: string;
      auth?: boolean;
      automation?: string;
      run?: string;
    } = {}
  ) => {
    const automation = input.automation ?? automationId;
    const run = input.run ?? jobRunId;
    return handler(
      new Request(
        `https://mogplex.com/api/v1/mogplex/automations/${automation}/runs/${run}/artifact?path=${encodeURIComponent(input.artifactPath ?? path)}`,
        {
          headers:
            input.auth === false ? {} : { authorization: "Bearer mog_test" },
        }
      ),
      { params: Promise.resolve({ automationId: automation, runId: run }) }
    );
  };
  return { request, urls, jobRunLoads, repoLoads };
}

test("automation artifact reads the run's recorded branch in the run's repository", async () => {
  const { request, urls, jobRunLoads, repoLoads } = await setup();
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await response.json()).data.artifact, {
    automationId,
    jobRunId,
    repoId: "repo-1",
    path,
    branch,
    commitSha,
    pinned: false,
    content: { ready: true },
  });
  assert.deepEqual(jobRunLoads, [
    { userId: "user-123", automationId, jobRunId, path },
  ]);
  assert.deepEqual(repoLoads, [{ repoId: "repo-1", userId: "user-123" }]);
  assert.equal(
    urls[0],
    `https://api.github.com/repos/webrenew/previews/commits/${encodeURIComponent(branch)}`
  );
});

test("automation artifact refuses anonymous, cross-owner and read-less callers", async () => {
  const anonymous = await setup();
  assert.equal((await anonymous.request({ auth: false })).status, 401);
  assert.equal(anonymous.jobRunLoads.length, 0);

  const other = await setup({ owned: false });
  const response = await other.request();
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
  assert.equal(other.urls.length, 0);

  const writeOnly = await setup({ scopes: ["write"] });
  assert.equal((await writeOnly.request()).status, 403);
  assert.equal(writeOnly.jobRunLoads.length, 0);
});

test("automation artifact rejects malformed ids and paths before any lookup", async () => {
  const { request, jobRunLoads, urls } = await setup();
  for (const input of [
    { automation: "not-a-uuid" },
    { run: "not-a-uuid" },
    { artifactPath: ".env" },
    { artifactPath: ".mogplex/artifacts/../../secrets.json" },
    { artifactPath: ".mogplex/artifacts/secret.txt" },
  ]) {
    const response = await request(input);
    assert.equal(response.status, 400, JSON.stringify(input));
    assert.equal((await response.json()).error.code, "BAD_REQUEST");
  }
  assert.equal(jobRunLoads.length, 0);
  assert.equal(urls.length, 0);
});

test("automation artifact waits for a successful run", async () => {
  for (const status of ["pending", "running", "failed", "cancelled"]) {
    const { request, urls, repoLoads } = await setup({ status });
    const response = await request();
    assert.equal(response.status, 409, status);
    assert.equal(
      (await response.json()).error.message,
      "Artifacts require a successful automation run"
    );
    assert.equal(repoLoads.length, 0);
    assert.equal(urls.length, 0);
  }
});

test("automation artifact never reads a branch the API trigger did not fix", async () => {
  for (const metadata of [
    null,
    { repo_id: "repo-1" },
    { working_branch: "main", repo_id: "repo-1" },
    { working_branch: "mogplex/task-123", repo_id: "repo-1" },
    { working_branch: `${branch}/../main`, repo_id: "repo-1" },
    { working_branch: branch },
  ]) {
    const { request, urls, repoLoads } = await setup({ metadata });
    const response = await request();
    assert.equal(response.status, 409, JSON.stringify(metadata));
    assert.equal(
      (await response.json()).error.message,
      "Artifacts are available only for API-triggered automation runs"
    );
    assert.equal(repoLoads.length, 0);
    assert.equal(urls.length, 0);
  }
});

test("automation artifact reports GitHub and storage failures without leaking detail", async () => {
  const disconnected = await setup({ githubToken: null });
  const reconnect = await disconnected.request();
  assert.equal(reconnect.status, 409);
  assert.equal(
    (await reconnect.json()).error.message,
    "Reconnect GitHub to read the artifact"
  );

  const provider = await setup({ providerFailure: true });
  const unavailable = await provider.request();
  assert.equal(unavailable.status, 502);
  assert.equal((await unavailable.json()).error.code, "SERVICE_UNAVAILABLE");

  const storage = await setup({ repositoryFailure: true });
  const failed = await storage.request();
  assert.equal(failed.status, 500);
  const body = await failed.text();
  assert.match(body, /Could not read artifact/);
  assert.doesNotMatch(body, /PRIVATE DATABASE DETAIL/);
});

test("MogplexApiClient reads an automation run artifact by path", async () => {
  const seen: string[] = [];
  const client = new MogplexApiClient({
    baseUrl: "https://app.example",
    authorization: "mog_test",
    fetch: async (input) => {
      seen.push(String(input));
      return Response.json({ ok: true, data: { artifact: { path } } });
    },
  });
  await client.getAutomationRunArtifact({
    automationId,
    runId: jobRunId,
    path,
  });
  assert.deepEqual(seen, [
    `https://app.example/api/v1/mogplex/automations/${automationId}/runs/${jobRunId}/artifact?path=${encodeURIComponent(path)}`,
  ]);
});

test("Mogplex MCP get_automation_run_artifact validates ids and returns the artifact", async () => {
  const calls: unknown[] = [];
  const artifact = {
    automationId,
    jobRunId,
    repoId: "repo-1",
    path,
    branch,
    commitSha,
    pinned: false,
    content: { ready: true },
  };
  const client = buildFakeMcpClient({
    getAutomationRunArtifact: async (input) => {
      calls.push(input);
      return { artifact };
    },
  });
  const call = (args: Record<string, unknown>) =>
    handleMogplexMcpPayload(
      {
        jsonrpc: "2.0",
        id: "automation-artifact",
        method: "tools/call",
        params: {
          name: "mogplex_get_automation_run_artifact",
          arguments: args,
        },
      },
      { client }
    );

  const result = (
    assertSingleMcpResponse(
      await call({ automationId, runId: jobRunId, path })
    ) as {
      result: {
        content: { text: string }[];
        structuredContent: { artifact: typeof artifact };
      };
    }
  ).result;
  assert.deepEqual(calls, [{ automationId, runId: jobRunId, path }]);
  assert.deepEqual(result.structuredContent.artifact, artifact);
  assert.match(result.content[0].text, /at commit ccccccc \(branch tip of /);

  const invalid = assertSingleMcpResponse(
    await call({ automationId, runId: "run-1", path })
  );
  assert.ok("error" in invalid);
  assert.equal(calls.length, 1);
});
