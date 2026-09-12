import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDependabotTools,
  fetchDependabotAlert,
} from "../../lib/agents/dependabot";
import type { SandboxFileAccess } from "../../lib/agents/pr-fixer-utils";
import { buildPromptForJob } from "../../lib/workflows/automation-job-prompts";

const toolOptions = { toolCallId: "call", messages: [] };
const canonical = {
  number: 17,
  state: "open",
  security_vulnerability: { first_patched_version: { identifier: "1.2.8" } },
};
const identity = {
  repoFullName: "acme/widgets",
  alertNumber: 17,
  githubToken: "test-token",
};

test("created remediation rechecks GitHub before commands and returns real validation failures", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  let commands = 0;
  let state = "open";
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(
      String(url),
      "https://api.github.com/repos/acme/widgets/dependabot/alerts/17"
    );
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer test-token"
    );
    return Response.json({ ...canonical, state });
  };
  try {
    const tools = buildDependabotTools({
      ...identity,
      action: "created",
      loadSandbox: async () => ({
        cwd: "packages/web",
        sandbox: {
          runCommand: async (input) => {
            commands++;
            assert.equal(
              typeof input === "object" && input.cwd,
              "packages/web"
            );
            return {
              exitCode: 2,
              stdout: async () => "tests failed",
              stderr: async () => "type mismatch",
            };
          },
        } as SandboxFileAccess,
      }),
    });
    const result = await tools.runCommand!.execute!(
      { command: "pnpm test" },
      toolOptions
    );
    assert.deepEqual(result, {
      exitCode: 2,
      stdout: "tests failed",
      stderr: "type mismatch",
    });
    state = "fixed";
    const blocked = await tools.runCommand!.execute!(
      { command: "git push" },
      toolOptions
    );
    assert.equal("blocked" in blocked && blocked.blocked, true);
    assert.equal(commands, 1);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("lifecycle actions expose only canonical read access", async () => {
  for (const action of [
    "fixed",
    "dismissed",
    "reopened",
    "reintroduced",
    "auto_dismissed",
    "unknown",
  ]) {
    const tools = buildDependabotTools({
      ...identity,
      action,
      loadSandbox: async () => {
        throw new Error("must not launch");
      },
    });
    assert.deepEqual(Object.keys(tools), ["getDependabotAlert"]);
  }
});

test("no patched version, invalid identity and denied access never launch a workspace", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ ...canonical, security_vulnerability: {} });
    const tools = buildDependabotTools({
      ...identity,
      action: "created",
      loadSandbox: async () => {
        throw new Error("must not launch");
      },
    });
    const result = await tools.runCommand!.execute!(
      { command: "pnpm update" },
      toolOptions
    );
    assert.equal("blocked" in result && result.blocked, true);
    for (const status of [401, 403, 404, 500]) {
      globalThis.fetch = async () => new Response("private detail", { status });
      await assert.rejects(
        async () => {
          await tools.getDependabotAlert.execute!({}, toolOptions);
        },
        new RegExp(`returned ${status}`)
      );
    }
    await assert.rejects(
      fetchDependabotAlert({ ...identity, alertNumber: 0 }),
      /identity/
    );
    globalThis.fetch = async () => Response.json({ ...canonical, number: 99 });
    await assert.rejects(
      fetchDependabotAlert(identity),
      /invalid Dependabot alert/
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("remediation policy covers validation, major and indirect updates, PR evidence and fixed state", () => {
  const metadata = {
    repo_full_name: "acme/widgets",
    alert_number: 17,
    webhook_action: "created",
    ghsa_id: "GHSA-123",
    cve_id: "CVE-2026-1",
    severity: "high",
    dependency_package: "minimist",
  };
  const { prompt } = buildPromptForJob("dependabot_alert", metadata, null);
  for (const text of [
    "getDependabotAlert",
    "native package manager",
    "major-version",
    "indirect",
    "validation fails",
    "lint, typecheck, test, and build",
    "old and new versions",
    "do not auto-merge",
    "Never dismiss",
    "default branch",
    "GHSA-123",
    "CVE-2026-1",
  ])
    assert.ok(prompt.includes(text), text);
  for (const action of [
    "fixed",
    "dismissed",
    "reopened",
    "reintroduced",
    "auto_dismissed",
  ]) {
    const lifecycle = buildPromptForJob(
      "dependabot_alert",
      {
        ...metadata,
        webhook_action: action,
        dismissed_comment: "human context",
      },
      null
    ).prompt;
    assert.ok(lifecycle.includes("Do not start remediation"));
    assert.ok(lifecycle.includes("human context"));
  }
});
