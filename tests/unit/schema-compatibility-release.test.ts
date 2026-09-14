import assert from "node:assert/strict";
import test from "node:test";
import {
  deployedCommit,
  resolveDeployedCommit,
} from "../../scripts/resolve-deployed-commit.mjs";

const sha = "1234567890abcdef1234567890abcdef12345678";
function project() {
  return {
    link: { type: "github", org: "Example", repo: "app" },
    targets: {
      production: { readyState: "READY", meta: { githubCommitSha: sha } },
    },
  };
}
test("compatibility uses the actual production commit, with a matching repository", () => {
  assert.equal(deployedCommit(project(), "example/app"), sha);
});
test("compatibility refuses an unrelated project or missing deployment metadata", () => {
  assert.throws(
    () => deployedCommit(project(), "example/another-app"),
    /different repository/
  );
  assert.throws(
    () => deployedCommit({ ...project(), targets: {} }, "example/app"),
    /No ready production deployment/
  );
  const missing = project();
  missing.targets.production.meta.githubCommitSha = "";
  assert.throws(
    () => deployedCommit(missing, "example/app"),
    /missing its Git commit SHA/
  );
});
test("deployment lookup preserves team scope and fails closed on API errors", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (input: URL, options: RequestInit) => {
      assert.equal(input.origin, "https://api.vercel.com");
      assert.equal(input.pathname, "/v9/projects/app");
      assert.equal(input.searchParams.get("slug"), "example");
      assert.deepEqual(options.headers, { Authorization: "Bearer fixture" });
      return new Response(JSON.stringify(project()), { status: 200 });
    }
  );
  const options = {
    token: "fixture",
    project: "app",
    team: "example",
    repository: "example/app",
  };
  assert.equal(await resolveDeployedCommit(options), sha);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("Unavailable", { status: 503 })
  );
  await assert.rejects(resolveDeployedCommit(options), /HTTP 503/);
});
