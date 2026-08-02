import { getHarnessConfig } from "./config";
import type { HarnessConfig, HarnessId } from "./config";
import type { Sandbox } from "@vercel/sandbox";

type InstalledPackageTree = {
  dependencies?: Record<string, { version?: string }>;
};

function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

export function getHarnessInstallSpec(config: HarnessConfig) {
  return `${config.package}@${config.version}`;
}

function getHarnessInstallMarkerPath(harnessId: HarnessId, version: string) {
  const safeVersion = version.replace(/[^\w.-]+/gi, "-");
  return `.mogplex/harness-${harnessId}-${safeVersion}-installed`;
}

async function writeHarnessMarker(
  sandbox: Sandbox,
  harnessId: HarnessId,
  version: string
) {
  try {
    await sandbox.writeFiles([
      {
        path: getHarnessInstallMarkerPath(harnessId, version),
        content: Buffer.from("1"),
      },
    ]);
  } catch {
    // marker write is non-critical
  }
}

export async function isHarnessInstalled(
  sandbox: Sandbox,
  harnessId: HarnessId
): Promise<boolean> {
  const config = getHarnessConfig(harnessId);
  const markerPath = getHarnessInstallMarkerPath(harnessId, config.version);

  try {
    const marker = await sandbox.readFile({ path: markerPath });
    if (marker) return true;
  } catch {
    // no marker, fall through to npm version check
  }

  const result = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      `npm ls -g '${escapeShell(config.package)}' --json --depth 0`,
    ],
  });

  const stdout =
    typeof result.stdout === "function" ? await result.stdout() : "";
  let installedVersion: string | null = null;

  try {
    const parsed = JSON.parse(stdout || "{}") as InstalledPackageTree;
    installedVersion = parsed.dependencies?.[config.package]?.version ?? null;
  } catch {
    // Treat unreadable npm output as not installed.
  }

  if (installedVersion === config.version) {
    await writeHarnessMarker(sandbox, harnessId, config.version);
    return true;
  }

  return false;
}

export async function installHarnessPackage(
  sandbox: Sandbox,
  harnessId: HarnessId
): Promise<string> {
  const config = getHarnessConfig(harnessId);
  const installSpec = getHarnessInstallSpec(config);

  const result = await sandbox.runCommand({
    cmd: "sh",
    args: ["-lc", `npm i -g ${installSpec}`],
  });
  const [stdout, stderr] = await Promise.all([
    result.stdout(),
    result.stderr(),
  ]);
  const logs = [stdout, stderr].filter(Boolean).join("\n").trim();

  if (result.exitCode !== 0) {
    throw new Error(`Failed to install ${installSpec}: ${logs}`);
  }

  await writeHarnessMarker(sandbox, harnessId, config.version);
  return logs;
}
