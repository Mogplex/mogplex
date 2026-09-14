import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function readDeploymentId(deploymentId?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, SENTRY_AUTH_TOKEN: "" };
  delete env.MOGPLEX_DEPLOYMENT_ID;
  if (deploymentId) {
    env.MOGPLEX_DEPLOYMENT_ID = deploymentId;
  }

  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import config from "./next.config.mjs"; process.stdout.write(JSON.stringify(config.deploymentId ?? null));',
      ],
      { cwd: new URL("../../", import.meta.url), env, encoding: "utf8" }
    )
  ) as string | null;
}

test("prebuilt releases retain their unique deployment ID for skew protection", () => {
  assert.equal(readDeploymentId("gh-123456789-1"), "gh-123456789-1");
  assert.equal(readDeploymentId("gh-123456789-2"), "gh-123456789-2");
});

test("builds without a custom ID leave deployment identification to Next.js", () => {
  assert.equal(readDeploymentId(), null);
});
