import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

async function loadTriggerVercelBuildEnv() {
  return import("../../lib/trigger/vercel-build-env");
}

test("resolveTriggerVercelBuildEnv supports the repo platform Vercel env names and linked project fallback", async () => {
  const { resolveTriggerVercelBuildEnv } = await loadTriggerVercelBuildEnv();
  const dir = mkdtempSync(join(tmpdir(), "mogplex-trigger-env-"));
  const projectLinkPath = join(dir, "project.json");

  try {
    writeFileSync(
      projectLinkPath,
      JSON.stringify({ projectId: "prj_from_link" })
    );

    const resolved = resolveTriggerVercelBuildEnv(
      {
        PLATFORM_VERCEL_TOKEN: "platform-token",
        PLATFORM_VERCEL_TEAM_ID: "team-from-platform",
      } as unknown as NodeJS.ProcessEnv,
      projectLinkPath
    );

    assert.deepEqual(resolved, {
      vercelAccessToken: "platform-token",
      vercelProjectId: "prj_from_link",
      vercelTeamId: "team-from-platform",
      envSyncEnabled: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTriggerVercelBuildEnv writes the standard Trigger/Vercel env names when aliases are present", async () => {
  const { applyTriggerVercelBuildEnv } = await loadTriggerVercelBuildEnv();
  const env = {
    PLATFORM_VERCEL_TOKEN: "platform-token",
    PLATFORM_VERCEL_PROJECT_ID: "prj_from_platform",
    PLATFORM_VERCEL_TEAM_ID: "team-from-platform",
  } as unknown as NodeJS.ProcessEnv;

  const resolved = applyTriggerVercelBuildEnv(env);

  assert.equal(env.VERCEL_ACCESS_TOKEN, "platform-token");
  assert.equal(env.VERCEL_PROJECT_ID, "prj_from_platform");
  assert.equal(env.VERCEL_TEAM_ID, "team-from-platform");
  assert.equal(resolved.envSyncEnabled, true);
});
