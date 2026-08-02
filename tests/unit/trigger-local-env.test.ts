import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

async function loadTriggerLocalEnv() {
  return import("../../lib/trigger/load-local-env");
}

test("loadLocalEnvFiles applies .env first and lets .env.local override it", async () => {
  const { loadLocalEnvFiles } = await loadTriggerLocalEnv();
  const dir = mkdtempSync(join(tmpdir(), "mogplex-trigger-local-env-"));
  const env = {} as NodeJS.ProcessEnv;

  try {
    writeFileSync(join(dir, ".env"), "SHARED=from-dotenv\nKEEP=dotenv\n");
    writeFileSync(join(dir, ".env.local"), "KEEP=dotenv-local\n");

    const loaded = loadLocalEnvFiles(dir, env);

    assert.equal(loaded.length, 2);
    assert.equal(env.SHARED, "from-dotenv");
    assert.equal(env.KEEP, "dotenv-local");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadLocalEnvFiles does not overwrite env vars already present in the process environment", async () => {
  const { loadLocalEnvFiles } = await loadTriggerLocalEnv();
  const dir = mkdtempSync(join(tmpdir(), "mogplex-trigger-local-env-"));
  const env = {
    PRESET: "from-shell",
  } as unknown as NodeJS.ProcessEnv;

  try {
    writeFileSync(
      join(dir, ".env.local"),
      "PRESET=from-file\nEXTRA='quoted value'\n"
    );

    loadLocalEnvFiles(dir, env);

    assert.equal(env.PRESET, "from-shell");
    assert.equal(env.EXTRA, "quoted value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveTriggerCliEnvFiles appends extra env files for CI-triggered deploys", async () => {
  const { resolveTriggerCliEnvFiles } = await loadTriggerLocalEnv();

  assert.deepEqual(resolveTriggerCliEnvFiles(undefined), [
    ".env",
    ".env.local",
  ]);
  assert.deepEqual(
    resolveTriggerCliEnvFiles(" .vercel/.env.production.local , custom.env "),
    [".env", ".env.local", ".vercel/.env.production.local", "custom.env"]
  );
});
