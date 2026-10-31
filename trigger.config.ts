import { aptGet, syncVercelEnvVars } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk/v3";
import { resolveTriggerProjectRef } from "./lib/trigger/project-ref";
import { resolveTriggerVercelBuildEnv } from "./lib/trigger/vercel-build-env";

const {
  vercelAccessToken,
  vercelProjectId,
  vercelTeamId,
  envSyncEnabled: vercelEnvSyncEnabled,
} = resolveTriggerVercelBuildEnv();
// Trigger's GitHub integration builds evaluate this config without our env
// vars, so the hosted ref stays the default here. Human-run deploys go through
// `pnpm trigger:*`, which refuses to fall back (scripts/trigger-cli.ts).
const { ref: triggerProjectRef } = resolveTriggerProjectRef();

export default defineConfig({
  project: triggerProjectRef,
  dirs: ["trigger"],
  // Keep workers on the app's Node major. The aligned CLI supplies the patched
  // Node 22.23.4 image; existing deployments require a redeploy to pick it up.
  runtime: "node-22",
  logLevel: "log",
  maxDuration: 1800,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
    },
  },
  build: {
    extensions: [
      // node-liblzma is a transitive native dep of just-bash (lib/virtual-shell.ts),
      // which the Slack handler task pulls in via runChatAgent → tools.ts. Its
      // build needs pkg-config + liblzma headers, which aren't in the default
      // Trigger.dev build image.
      aptGet({ packages: ["pkg-config", "liblzma-dev"] }),
      ...(vercelEnvSyncEnabled
        ? [
            syncVercelEnvVars({
              vercelAccessToken: vercelAccessToken ?? undefined,
              projectId: vercelProjectId ?? undefined,
              vercelTeamId: vercelTeamId ?? undefined,
            }),
          ]
        : []),
    ],
  },
});
