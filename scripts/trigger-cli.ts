import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { applyTriggerVercelBuildEnv } from "../lib/trigger/vercel-build-env";
import { resolveTriggerCliPackage } from "../lib/trigger/cli-package";
import {
  loadLocalEnvFiles,
  resolveTriggerCliEnvFiles,
} from "../lib/trigger/load-local-env";

loadLocalEnvFiles(
  process.cwd(),
  process.env,
  resolveTriggerCliEnvFiles(process.env.TRIGGER_CLI_ENV_FILES)
);
applyTriggerVercelBuildEnv(process.env);

function readPackageVersion(path: URL): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      version?: unknown;
    };

    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

const triggerCliPackage = resolveTriggerCliPackage({
  sdkVersion: readPackageVersion(
    new URL("../node_modules/@trigger.dev/sdk/package.json", import.meta.url)
  ),
  buildVersion: readPackageVersion(
    new URL("../node_modules/@trigger.dev/build/package.json", import.meta.url)
  ),
});
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const child = spawn("pnpm", ["dlx", triggerCliPackage, ...args], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
