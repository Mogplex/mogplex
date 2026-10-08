import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

// A write-scoped key its owner set to Automations only.
const resolveApiKey = async () => ({
  ok: true as const,
  auth: {
    userId: "user-1",
    keyId: "key-1",
    scopes: ["read", "write"],
    access: "automations" as const,
  },
});

// The same key with Full access, as every key had before access existed.
const resolveFullAccessKey = async () => ({
  ok: true as const,
  auth: {
    userId: "user-1",
    keyId: "key-1",
    scopes: ["read", "write"],
    access: "full" as const,
  },
});

// The repository, installation or automation belongs to a team whose owner
// holds members' keys to automations.
const restrictedTeam = async () => "automations" as const;
const personalWork = async () => null;

function sideEffect(name: string): () => never {
  return () => {
    throw new Error(`${name} must not run for this credential`);
  };
}

function patRequest(path: string, method: string, body?: unknown) {
  return new NextRequest(`https://mogplex.test/api/v1/mogplex${path}`, {
    method,
    headers: {
      authorization: "Bearer mog_integration",
      "content-type": "application/json",
      "idempotency-key": "k1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function assertAutomationRequired(response: Response) {
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error.code, "AUTOMATION_REQUIRED");
  assert.match(payload.error.message, /configured automation/);
  return payload.error.message as string;
}

const automationParams = {
  params: Promise.resolve({ automationId: "flow-1" }),
};
const repoParams = { params: Promise.resolve({ repoId: "repo-1" }) };

test("automations-only keys cannot start a direct run", async () => {
  const { createMogplexApiRunsPostHandler } =
    await import("../../app/api/v1/mogplex/runs/route");
  const handler = createMogplexApiRunsPostHandler({
    resolveApiKey,
    startRun: sideEffect("startRun"),
  });
  await assertAutomationRequired(
    await handler(
      patRequest("/runs", "POST", {
        repoId: "repo-1",
        prompt: "Build it",
        mode: "AUTO",
      })
    )
  );
});

test("automations-only keys cannot launch a sandbox", async () => {
  const { createMogplexApiSandboxesPostHandler } =
    await import("../../app/api/v1/mogplex/sandboxes/route");
  const handler = createMogplexApiSandboxesPostHandler({
    resolveApiKey,
    listSandboxes: sideEffect("listSandboxes"),
    launchSandbox: sideEffect("launchSandbox"),
  });
  await assertAutomationRequired(
    await handler(patRequest("/sandboxes", "POST", { repoId: "repo-1" }))
  );
});

test("automations-only keys cannot create, edit, publish, retarget or delete automations", async () => {
  const collection = await import("../../app/api/v1/mogplex/automations/route");
  const item =
    await import("../../app/api/v1/mogplex/automations/[automationId]/route");
  const publish =
    await import("../../app/api/v1/mogplex/automations/[automationId]/publish/route");
  const model =
    await import("../../app/api/v1/mogplex/automations/[automationId]/model/route");
  const itemDeps = {
    resolveApiKey,
    getAutomation: sideEffect("getAutomation"),
    updateAutomation: sideEffect("updateAutomation"),
    deleteAutomation: sideEffect("deleteAutomation"),
  };

  await assertAutomationRequired(
    await collection.createMogplexApiAutomationsPostHandler({
      resolveApiKey,
      listAutomations: sideEffect("listAutomations"),
      createAutomation: sideEffect("createAutomation"),
    })(patRequest("/automations", "POST", { installationId: 1, name: "x" }))
  );
  await assertAutomationRequired(
    await item.createMogplexApiAutomationPutHandler(itemDeps)(
      patRequest("/automations/flow-1", "PUT", { name: "x" }),
      automationParams
    )
  );
  await assertAutomationRequired(
    await item.createMogplexApiAutomationDeleteHandler(itemDeps)(
      patRequest("/automations/flow-1", "DELETE"),
      automationParams
    )
  );
  await assertAutomationRequired(
    await publish.createMogplexApiAutomationPublishPostHandler({
      resolveApiKey,
      publishAutomation: sideEffect("publishAutomation"),
    })(patRequest("/automations/flow-1/publish", "POST"), automationParams)
  );
  await assertAutomationRequired(
    await model.createMogplexApiAutomationModelPutHandler({
      resolveApiKey,
      setModel: sideEffect("setModel"),
    })(
      patRequest("/automations/flow-1/model", "PUT", { model: "openai/gpt-5" }),
      automationParams
    )
  );
});

test("automations-only keys cannot change repository environment variables", async () => {
  const route =
    await import("../../app/api/v1/mogplex/repos/[repoId]/env-vars/route");
  const deps = {
    resolveApiKey,
    listEnvVars: sideEffect("listEnvVars"),
    upsertEnvVar: sideEffect("upsertEnvVar"),
    deleteEnvVar: sideEffect("deleteEnvVar"),
  };
  await assertAutomationRequired(
    await route.createMogplexApiRepoEnvVarsPostHandler(deps)(
      patRequest("/repos/repo-1/env-vars", "POST", { key: "A", value: "b" }),
      repoParams
    )
  );
  await assertAutomationRequired(
    await route.createMogplexApiRepoEnvVarsDeleteHandler(deps)(
      patRequest("/repos/repo-1/env-vars?key=A", "DELETE"),
      repoParams
    )
  );
});

test("automations-only keys can trigger an automation with an idempotency key and are recorded as the trigger", async () => {
  const { createMogplexApiAutomationTriggerPostHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/trigger/route");
  const calls: unknown[] = [];
  const handler = createMogplexApiAutomationTriggerPostHandler({
    resolveApiKey,
    triggerAutomation: async (input) => {
      calls.push(input);
      return {
        automationId: input.automationId,
        versionId: "version-1",
        versionNumber: 3,
        jobRunId: "job-1",
        workingBranch: "mogplex/automation-0123456789abcdef",
        outcome: "queued",
        reason: null,
        replayed: false,
        started: true,
        status: "running",
        runtime: { provider: "trigger", runId: "runtime-1" },
      };
    },
  });

  const missingKey = await handler(
    new NextRequest(
      "https://mogplex.example/api/v1/mogplex/automations/flow-1/trigger",
      {
        method: "POST",
        headers: { authorization: "Bearer mog_valid" },
        body: JSON.stringify({ repoId: "repo-1" }),
      }
    ),
    { params: Promise.resolve({ automationId: "flow-1" }) }
  );
  assert.equal(missingKey.status, 400);

  const response = await handler(
    new NextRequest(
      "https://mogplex.example/api/v1/mogplex/automations/flow-1/trigger",
      {
        method: "POST",
        headers: {
          authorization: "Bearer mog_valid",
          "idempotency-key": "tool-call-1",
        },
        body: JSON.stringify({
          repoId: "repo-1",
          input: { pull_request: { number: 42 } },
        }),
      }
    ),
    { params: Promise.resolve({ automationId: "flow-1" }) }
  );

  assert.equal(response.status, 202);
  assert.deepEqual(calls, [
    {
      userId: "user-1",
      automationId: "flow-1",
      repoId: "repo-1",
      idempotencyKey: "tool-call-1",
      input: { pull_request: { number: 42 } },
      credential: {
        kind: "integration",
        keyId: "key-1",
        automationOnly: true,
      },
    },
  ]);
});

test("full-access keys start a direct run on personal work", async () => {
  const { createMogplexApiRunsPostHandler } =
    await import("../../app/api/v1/mogplex/runs/route");
  let started = false;
  const handler = createMogplexApiRunsPostHandler({
    resolveApiKey: resolveFullAccessKey,
    loadTeamKeyAccess: personalWork,
    enforceRunStartLimits: async () => ({ allowed: true }),
    startRun: async () => {
      started = true;
      return { run: { id: "run-1" }, replayed: false } as never;
    },
  });
  const response = await handler(
    patRequest("/runs", "POST", { repoId: "repo-1", prompt: "Build it" })
  );
  assert.equal(response.status, 202);
  assert.equal(started, true);
});

test("full-access keys cannot start work directly on a team that holds keys to automations", async () => {
  const runs = await import("../../app/api/v1/mogplex/runs/route");
  const sandboxes = await import("../../app/api/v1/mogplex/sandboxes/route");
  const envVars =
    await import("../../app/api/v1/mogplex/repos/[repoId]/env-vars/route");
  const collection = await import("../../app/api/v1/mogplex/automations/route");
  const publish =
    await import("../../app/api/v1/mogplex/automations/[automationId]/publish/route");

  const responses = [
    await runs.createMogplexApiRunsPostHandler({
      resolveApiKey: resolveFullAccessKey,
      loadTeamKeyAccess: restrictedTeam,
      enforceRunStartLimits: sideEffect("enforceRunStartLimits"),
      startRun: sideEffect("startRun"),
    })(patRequest("/runs", "POST", { repoId: "repo-1", prompt: "Build it" })),
    await sandboxes.createMogplexApiSandboxesPostHandler({
      resolveApiKey: resolveFullAccessKey,
      loadTeamKeyAccess: restrictedTeam,
      listSandboxes: sideEffect("listSandboxes"),
      launchSandbox: sideEffect("launchSandbox"),
    })(patRequest("/sandboxes", "POST", { repoId: "repo-1" })),
    await envVars.createMogplexApiRepoEnvVarsPostHandler({
      resolveApiKey: resolveFullAccessKey,
      loadTeamKeyAccess: restrictedTeam,
      listEnvVars: sideEffect("listEnvVars"),
      upsertEnvVar: sideEffect("upsertEnvVar"),
      deleteEnvVar: sideEffect("deleteEnvVar"),
    })(
      patRequest("/repos/repo-1/env-vars", "POST", { key: "A", value: "b" }),
      repoParams
    ),
    await collection.createMogplexApiAutomationsPostHandler({
      resolveApiKey: resolveFullAccessKey,
      loadTeamKeyAccess: restrictedTeam,
      listAutomations: sideEffect("listAutomations"),
      createAutomation: sideEffect("createAutomation"),
    })(patRequest("/automations", "POST", { installationId: 1, name: "x" })),
    await publish.createMogplexApiAutomationPublishPostHandler({
      resolveApiKey: resolveFullAccessKey,
      loadTeamKeyAccess: restrictedTeam,
      publishAutomation: sideEffect("publishAutomation"),
    })(patRequest("/automations/flow-1/publish", "POST"), automationParams),
  ];
  for (const response of responses) {
    assert.match(await assertAutomationRequired(response), /team owner/);
  }
});

test("full-access keys on a restricted team may trigger only API automations", async () => {
  const { createMogplexApiAutomationTriggerPostHandler } =
    await import("../../app/api/v1/mogplex/automations/[automationId]/trigger/route");
  const calls: { credential?: { automationOnly?: boolean } }[] = [];
  const handler = createMogplexApiAutomationTriggerPostHandler({
    resolveApiKey: resolveFullAccessKey,
    loadTeamKeyAccess: restrictedTeam,
    triggerAutomation: async (input) => {
      calls.push(input);
      throw new Error("stop after recording the credential");
    },
  });
  await handler(
    patRequest("/automations/flow-1/trigger", "POST", { repoId: "repo-1" }),
    automationParams
  );
  assert.equal(calls[0]?.credential?.automationOnly, true);
});
