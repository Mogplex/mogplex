import assert from "node:assert/strict";
import test from "node:test";
import { presentMogplexApiRun } from "../../lib/mogplex-api/runs";
import {
  buildRunRow,
  buildUser,
  loadRunDetailRoute,
} from "./helpers/mogplex-api-runs-fixtures";

const commitSha = "a".repeat(40);
const path = ".mogplex/artifacts/preview-test.json";
async function setup(
  options: {
    owned?: boolean;
    status?: "success" | "streaming";
    mode?: string;
    content?: string;
    providerFailure?: boolean;
  } = {}
) {
  await loadRunDetailRoute();
  const { loadRunArtifact, RunArtifactError } =
    await import("../../lib/mogplex-api/run-artifacts");
  const { createRunArtifactGetHandler } =
    await import("../../app/api/v1/mogplex/runs/[runId]/artifact/route");
  const urls: string[] = [];
  const handler = createRunArtifactGetHandler({
    resolveApiKey: async () => ({ ok: true, auth: buildUser() }),
    loadArtifact: (input) =>
      loadRunArtifact(input, {
        loadRun: async ({ userId }) =>
          options.owned === false || userId !== "user-123"
            ? null
            : presentMogplexApiRun(
                buildRunRow({
                  status: options.status ?? "success",
                  create_branch: true,
                })
              ),
        loadRepo: async () => ({
          repo: { user_id: "user-123", full_name: "webrenew/previews" },
          githubToken: "test-token",
        }),
        githubJson: async (_token, url) => {
          urls.push(url);
          if (options.providerFailure)
            throw new RunArtifactError(
              502,
              "Could not read the committed artifact"
            );
          if (url.includes("/commits/"))
            return { sha: commitSha, commit: { tree: { sha: "root" } } };
          if (url.endsWith("/trees/root"))
            return {
              tree: [
                { path: ".mogplex", mode: "040000", type: "tree", sha: "dir" },
              ],
            };
          if (url.endsWith("/trees/dir"))
            return {
              tree: [
                {
                  path: "artifacts",
                  mode: "040000",
                  type: "tree",
                  sha: "artifacts",
                },
              ],
            };
          if (url.endsWith("/trees/artifacts"))
            return {
              tree: [
                {
                  path: "preview-test.json",
                  mode: options.mode ?? "100644",
                  type: "blob",
                  sha: "blob",
                  size: 10,
                },
              ],
            };
          if (url.endsWith("/blobs/blob"))
            return {
              encoding: "base64",
              size: 10,
              content: Buffer.from(
                options.content ?? '{"ready":true}'
              ).toString("base64"),
            };
          throw new Error("Unexpected GitHub URL");
        },
      }),
  });
  const request = (artifactPath = path, auth = true) =>
    handler(
      new Request(
        `https://mogplex.com/api/v1/mogplex/runs/run-1/artifact?path=${encodeURIComponent(artifactPath)}`,
        { headers: auth ? { authorization: "Bearer mog_test" } : {} }
      ),
      { params: Promise.resolve({ runId: "run-1" }) }
    );
  return { request, urls };
}

test("artifact reads a regular JSON blob at a pinned commit using existing repo access", async () => {
  const { request, urls } = await setup();
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await response.json()).data.artifact, {
    runId: "run-1",
    repoId: "repo-1",
    branch: "mogplex/external/run",
    commitSha,
    path,
    content: { ready: true },
  });
  assert.equal(urls.filter((url) => url.includes("/commits/")).length, 1);
});

test("anonymous and cross-owner artifact reads are refused", async () => {
  const anonymous = await setup();
  assert.equal((await anonymous.request(path, false)).status, 401);
  assert.equal(anonymous.urls.length, 0);
  const other = await setup({ owned: false });
  assert.equal((await other.request()).status, 404);
  assert.equal(other.urls.length, 0);
});

test("artifact rejects traversal and non-output paths before provider access", async () => {
  const { request, urls } = await setup();
  for (const invalid of [
    ".env",
    ".mogplex/artifacts/../../secrets.json",
    ".mogplex/artifacts/secret.txt",
    "package.json",
  ])
    assert.equal((await request(invalid)).status, 400);
  assert.equal(urls.length, 0);
});

test("unfinished runs and symlinks cannot provide artifacts", async () => {
  const active = await setup({ status: "streaming" });
  assert.equal((await active.request()).status, 409);
  assert.equal(active.urls.length, 0);
  const symlink = await setup({ mode: "120000" });
  assert.equal((await symlink.request()).status, 400);
  assert.ok(!symlink.urls.some((url) => url.includes("/blobs/")));
});

test("invalid JSON and provider failures return safe errors", async () => {
  const invalid = await setup({ content: "PRIVATE INVALID DATA" });
  const response = await invalid.request();
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes("PRIVATE"));
  const failure = await setup({ providerFailure: true });
  assert.equal((await failure.request()).status, 502);
});
