import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configure, tasks } from "@trigger.dev/sdk/v3";
import { parse } from "yaml";
import { pinWorkerVersion, stopSchemaDriftRetries } from "../../trigger/init";
import { SCHEMA_DRIFT_MESSAGE } from "../../lib/schema-drift";

type TriggerRequest = {
  options: { externalDeploymentId?: string; lockToVersion?: string };
};

type InitInput = Parameters<typeof pinWorkerVersion>[0];

test("schema drift stops whole-task retries while unrelated failures keep their retry policy", async () => {
  const input = {
    ...workerInput("PRODUCTION"),
    error: new Error(`Write failed: ${SCHEMA_DRIFT_MESSAGE}`),
    retry: { maxAttempts: 3 },
  };
  assert.deepEqual(await stopSchemaDriftRetries(input), {
    skipRetrying: true,
  });
  assert.equal(
    await stopSchemaDriftRetries({
      ...input,
      error: new Error("network failure"),
    }),
    undefined
  );
});

function workerInput(type: InitInput["ctx"]["environment"]["type"]): InitInput {
  const now = new Date("2026-09-14T00:00:00Z");
  return {
    payload: {},
    task: "fixture",
    signal: new AbortController().signal,
    ctx: {
      task: { id: "fixture", filePath: "trigger/fixture.ts" },
      queue: { id: "queue_fixture", name: "fixture" },
      environment: { id: "env_fixture", slug: type.toLowerCase(), type },
      organization: { id: "org_fixture", slug: "fixture", name: "Fixture" },
      project: {
        id: "project_fixture",
        ref: "proj_fixture",
        slug: "fixture",
        name: "Fixture",
      },
      machine: { name: "small-1x", cpu: 1, memory: 1, centsPerMs: 0 },
      deployment: {
        id: "deployment_fixture",
        shortCode: "fixture",
        version: "20260914.2",
        runtime: "node",
        runtimeVersion: "22",
      },
      attempt: { number: 1, startedAt: now },
      run: {
        id: "run_fixture",
        tags: [],
        isTest: true,
        isReplay: false,
        createdAt: now,
        startedAt: now,
      },
    },
  };
}

function deployedRuntimeEnv(commit: string) {
  const workflow = parse(
    readFileSync(
      new URL("../../.github/workflows/deploy-production.yml", import.meta.url),
      "utf8"
    )
  ) as {
    jobs: Record<
      string,
      {
        steps: Array<{
          name: string;
          env?: Record<string, string>;
          run?: string;
        }>;
      }
    >;
  };
  const step = workflow.jobs["deploy-production"].steps.find(
    (entry) => entry.name === "Deploy production artifacts"
  );
  assert.ok(step?.run);
  const dir = mkdtempSync(join(tmpdir(), "mogplex-trigger-skew-"));
  try {
    // Emulate Vercel's deployment-scoped --env overrides, not shell/build env.
    writeFileSync(
      join(dir, "vercel"),
      `#!${process.execPath}
const fs = require("node:fs");
const env = { TRIGGER_VERSION: "stale-project-version" };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--env") {
    const value = args[++i];
    const split = value.indexOf("=");
    env[value.slice(0, split)] = value.slice(split + 1);
  }
}
fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify(env));
console.log("https://test.vercel.app");
`,
      { mode: 0o755 }
    );
    const stepEnv = Object.fromEntries(
      Object.entries(step.env ?? {}).map(([name, value]) => [
        name,
        // GitHub Actions expression, evaluated by the test instead of GitHub.
        // eslint-disable-next-line no-template-curly-in-string
        value.replaceAll("${{ github.sha }}", commit),
      ])
    );
    execFileSync("bash", ["-eu", "-c", step.run], {
      env: {
        ...process.env,
        ...stepEnv,
        GITHUB_SHA: commit,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_ENV: join(dir, "github-env"),
        CAPTURE_PATH: join(dir, "runtime.json"),
      },
    });
    return JSON.parse(
      readFileSync(join(dir, "runtime.json"), "utf8")
    ) as Record<string, string>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("production releases send their own commit to Trigger even after another release deploys", async (t) => {
  configure({ accessToken: "tr_dev_test", baseURL: "https://trigger.test" });
  const requests: TriggerRequest[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as TriggerRequest);
      return Response.json({ id: "run_test", isCached: false });
    }
  );
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });
  delete process.env.TRIGGER_EXTERNAL_DEPLOYMENT_ID;
  delete process.env.TRIGGER_AUTOMATIC_SKEW_VERSION_PROTECTION;
  const oldRelease = deployedRuntimeEnv("a".repeat(40));
  const newRelease = deployedRuntimeEnv("b".repeat(40));
  for (const release of [oldRelease, newRelease, oldRelease]) {
    Object.assign(process.env, release);
    await tasks.trigger("execute-automation-job", { jobRunId: "fixture" });
  }
  assert.deepEqual(
    requests.map(({ options }) => options.externalDeploymentId),
    ["a".repeat(40), "b".repeat(40), "a".repeat(40)]
  );
  assert.ok(requests.every(({ options }) => !options.lockToVersion));
});

test("production deploy rejects an empty commit instead of silently disabling task pins", () => {
  assert.throws(() => deployedRuntimeEnv(""), /TRIGGER_EXTERNAL_DEPLOYMENT_ID/);
});

test("worker child tasks stay on the executing worker version, including fire-and-forget dispatch", async (t) => {
  configure({ accessToken: "tr_dev_test", baseURL: "https://trigger.test" });
  const requests: TriggerRequest[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as TriggerRequest);
      return Response.json({ id: "run_test", isCached: false });
    }
  );
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });
  process.env.TRIGGER_VERSION = "stale-synced-version";
  process.env.TRIGGER_EXTERNAL_DEPLOYMENT_ID = "newer-app-release";
  process.env.TRIGGER_AUTOMATIC_SKEW_VERSION_PROTECTION = "1";
  process.env.VERCEL_GIT_COMMIT_SHA = "newer-app-release";
  for (const type of [
    "PRODUCTION",
    "PREVIEW",
    "STAGING",
    "DEVELOPMENT",
  ] as const) {
    await pinWorkerVersion(workerInput(type));
    await tasks.trigger("deliver-slack-run-update", {});
  }
  assert.deepEqual(
    requests.map(({ options }) => options.lockToVersion || undefined),
    ["20260914.2", "20260914.2", "20260914.2", undefined]
  );
  assert.ok(requests.every(({ options }) => !options.externalDeploymentId));
});

test("a worker without deployment metadata uses its run version and rejects an unknown version", async (t) => {
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });
  const input = workerInput("PRODUCTION");
  delete input.ctx.deployment;
  input.ctx.run.version = "20260914.1";
  await pinWorkerVersion(input);
  assert.equal(process.env.TRIGGER_VERSION, "20260914.1");
  delete input.ctx.run.version;
  assert.throws(() => pinWorkerVersion(input), /without the worker version/);
});
