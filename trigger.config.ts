import { aptGet, syncVercelEnvVars } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk/v3";
import { resolveTriggerVercelBuildEnv } from "./lib/trigger/vercel-build-env";

const {
  vercelAccessToken,
  vercelProjectId,
  vercelTeamId,
  envSyncEnabled: vercelEnvSyncEnabled,
} = resolveTriggerVercelBuildEnv();
// The project ref is a public identifier, not a secret — Trigger.dev's GitHub
// check publicly displays it in the check name, and putting it in source is
// Trigger's documented pattern. It must stay inline because Trigger's cloud
// builds evaluate this config without our env vars.
const triggerProjectRef =
  process.env.TRIGGER_PROJECT_REF?.trim() || "proj_ssjnkodxhnnukrwiymaf";

export default defineConfig({
  project: triggerProjectRef,
  dirs: ["trigger"],
  runtime: "node",
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
