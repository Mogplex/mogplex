import { getHarnessConfig } from "./config";
import type { HarnessAcpAgent, HarnessConfig, HarnessId } from "./config";
import type { Sandbox } from "@vercel/sandbox";

/** The npm package a run needs: the harness CLI, or its ACP agent. */
export type HarnessInstallTarget = {
  markerId: string;
  package: string;
  version: string;
};

type InstalledPackageTree = {
  dependencies?: Record<string, { version?: string }>;
};

function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

export function getHarnessInstallSpec(
  config: Pick<HarnessConfig, "package" | "version">
) {
  return `${config.package}@${config.version}`;
}

export function resolveHarnessInstallTarget(
  harnessId: HarnessId,
  acpAgent?: HarnessAcpAgent | null
): HarnessInstallTarget {
  const source = acpAgent ?? getHarnessConfig(harnessId);
  return {
    markerId: acpAgent ? `${harnessId}-acp` : harnessId,
    package: source.package,
    version: source.version,
  };
}

function getHarnessInstallMarkerPath(target: HarnessInstallTarget) {
  const safeVersion = target.version.replace(/[^\w.-]+/gi, "-");
  return `.mogplex/harness-${target.markerId}-${safeVersion}-installed`;
}

async function writeHarnessMarker(
  sandbox: Sandbox,
  target: HarnessInstallTarget
) {
  try {
    await sandbox.writeFiles([
      {
        path: getHarnessInstallMarkerPath(target),
        content: Buffer.from("1"),
      },
    ]);
  } catch {
    // marker write is non-critical
  }
}

export async function isHarnessInstalled(
  sandbox: Sandbox,
  harnessId: HarnessId,
  target: HarnessInstallTarget = resolveHarnessInstallTarget(harnessId)
): Promise<boolean> {
  const markerPath = getHarnessInstallMarkerPath(target);

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
      `npm ls -g '${escapeShell(target.package)}' --json --depth 0`,
    ],
  });

  const stdout =
    typeof result.stdout === "function" ? await result.stdout() : "";
  let installedVersion: string | null = null;

  try {
    const parsed = JSON.parse(stdout || "{}") as InstalledPackageTree;
    installedVersion = parsed.dependencies?.[target.package]?.version ?? null;
  } catch {
    // Treat unreadable npm output as not installed.
  }

  if (installedVersion === target.version) {
    await writeHarnessMarker(sandbox, target);
    return true;
  }

  return false;
}

export async function installHarnessPackage(
  sandbox: Sandbox,
  harnessId: HarnessId,
  target: HarnessInstallTarget = resolveHarnessInstallTarget(harnessId)
): Promise<string> {
  const installSpec = getHarnessInstallSpec(target);

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

  await writeHarnessMarker(sandbox, target);
  return logs;
}
