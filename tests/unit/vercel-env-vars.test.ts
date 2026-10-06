import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { buildRuntimeSandboxEnv } from "../../lib/repo-settings";
import {
  getRepoLinkedVercelProject,
  resolveRepoSandboxEnv,
} from "../../lib/vercel/env-vars";

test("legacy Vercel preferences preserve manual sandbox env without provider access", async () => {
  const providerFetch = mock.method(globalThis, "fetch", async () => {
    throw new Error("must not fetch provider env");
  });
  try {
    const repo = {
      env_sync_mode: "vercel-project",
      vercel_project_id: "prj_legacy",
      vercel_team_id: "team_legacy",
      sandbox_env_vars: { API_URL: '"https://example.com"', FEATURE: "on" },
    };
    assert.deepEqual(await resolveRepoSandboxEnv({ repo, userId: "user-1" }), {
      envVars: { API_URL: "https://example.com", FEATURE: "on" },
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    });
    assert.equal(getRepoLinkedVercelProject(repo), null);
    assert.equal(providerFetch.mock.callCount(), 0);
  } finally {
    providerFetch.mock.restore();
  }
});

test("manual preview env injection remains available", async () => {
  assert.deepEqual(
    await resolveRepoSandboxEnv({
      userId: "user-1",
      repo: {
        env_sync_mode: "sandbox-and-preview",
        sandbox_env_vars: { FEATURE: "on" },
      },
    }),
    {
      envVars: { FEATURE: "on" },
      sync: { mode: "sandbox-and-preview", source: "manual", warning: null },
    }
  );
});

test("buildRuntimeSandboxEnv applies preview conventions for vercel-project mode", () => {
  const env = buildRuntimeSandboxEnv(
    {},
    "vercel-project",
    "https://example-preview.vercel.app"
  );

  assert.equal(env.VERCEL, "1");
  assert.equal(env.VERCEL_ENV, "preview");
  assert.equal(env.VERCEL_TARGET_ENV, "preview");
  assert.equal(env.NEXT_PUBLIC_VERCEL_ENV, "preview");
  assert.equal(env.NEXT_PUBLIC_APP_URL, "https://example-preview.vercel.app");
  assert.equal(env.VERCEL_URL, "example-preview.vercel.app");
});
