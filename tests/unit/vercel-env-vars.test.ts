import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeSandboxEnv } from "../../lib/repo-settings";

async function loadVercelEnvHelpers() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/vercel/env-vars");
}

test("flattenVercelProjectEnvVars prefers preview values over development for duplicate keys", async () => {
  const { flattenVercelProjectEnvVars } = await loadVercelEnvHelpers();
  const envs = [
    { key: "DATABASE_URL", value: "postgres://dev", target: ["development"] },
    { key: "DATABASE_URL", value: "postgres://preview", target: ["preview"] },
    {
      key: "API_BASE_URL",
      value: "https://dev.example.com",
      target: ["development"],
    },
    {
      key: "SHARED_SECRET",
      value: "shared",
      target: ["preview", "development"],
    },
  ];

  assert.deepEqual(flattenVercelProjectEnvVars(envs), {
    DATABASE_URL: "postgres://preview",
    API_BASE_URL: "https://dev.example.com",
    SHARED_SECRET: "shared",
  });
});

test("mergeRepoSandboxEnvVars lets manual vars override synced Vercel vars", async () => {
  const { mergeRepoSandboxEnvVars } = await loadVercelEnvHelpers();

  assert.deepEqual(
    mergeRepoSandboxEnvVars(
      {
        DATABASE_URL: "postgres://preview",
        API_BASE_URL: "https://preview.example.com",
      },
      {
        DATABASE_URL: "postgres://manual",
        FEATURE_FLAG: "on",
      }
    ),
    {
      DATABASE_URL: "postgres://manual",
      API_BASE_URL: "https://preview.example.com",
      FEATURE_FLAG: "on",
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
