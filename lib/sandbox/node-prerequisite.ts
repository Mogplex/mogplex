import type { Sandbox } from "@vercel/sandbox";
import type { SandboxRuntime } from "./runtimes/types";
import { sandboxRepositoryFiles } from "./repository-files";
import {
  readNodeRequirements,
  satisfiesNodeRequirements,
  selectNodeVersion,
  type NodeRuntime,
} from "./runtimes/node-version";
import {
  BOOTSTRAP_STEP_TIMEOUT_MS,
  SandboxBootstrapError,
  withTimeout,
} from "./client-validation";

/** Provider images pin a minor release; a repository can require a newer one. */
export async function ensureNodePrerequisite(
  sandbox: Sandbox,
  runtime: SandboxRuntime,
  rootDirectory: string | null,
  previewUrl: string
) {
  if (!runtime.startsWith("node")) return "";
  const nodeRuntime = runtime as NodeRuntime;
  const requirements = await readNodeRequirements(
    sandboxRepositoryFiles(sandbox),
    rootDirectory
  );
  // Preserve the provider image when the repository has no Node declaration.
  if (requirements.engines.length === 0 && !requirements.versionFile) return "";
  const probe = await sandbox.runCommand({
    cmd: "node",
    args: [
      "-p",
      "JSON.stringify({version:process.version,arch:process.arch,platform:process.platform,execPath:process.execPath})",
    ],
  });
  if (probe.exitCode !== 0)
    throw new Error("Could not inspect sandbox Node.js version");
  const current: {
    version: string;
    arch: string;
    platform: string;
    execPath: string;
  } = JSON.parse(await probe.stdout());
  if (satisfiesNodeRequirements(current.version, nodeRuntime, requirements))
    return "";
  const target = `/vercel/runtimes/${nodeRuntime}/bin/node`;
  if (
    current.platform !== "linux" ||
    !["x64", "arm64"].includes(current.arch) ||
    current.execPath !== target
  ) {
    throw new Error(
      "Cannot provision the repository Node.js requirement in this sandbox runtime"
    );
  }
  const response = await fetch("https://nodejs.org/dist/index.json", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Could not load Node.js releases (${response.status})`);
  const releases: { version: string }[] = await response.json();
  const version = selectNodeVersion(
    releases.map((release) => release.version),
    nodeRuntime,
    requirements
  );
  const archive = `node-v${version}-linux-${current.arch}`;
  // Only validated semver/platform values reach this script. Verify the official
  // distribution before replacing the image's binary so every later command and
  // saved snapshot uses the selected version without changing PATH or npm/pnpm.
  const script = `set -eu
node_tmp=$(mktemp -d)
trap 'rm -rf "$node_tmp"' EXIT
cd "$node_tmp"
curl --fail --silent --show-error --location --max-time 90 -O https://nodejs.org/dist/v${version}/${archive}.tar.gz
curl --fail --silent --show-error --location --max-time 15 -O https://nodejs.org/dist/v${version}/SHASUMS256.txt
grep '  ${archive}.tar.gz$' SHASUMS256.txt | sha256sum -c -
tar -xzf ${archive}.tar.gz ${archive}/bin/node
sudo install -m 755 ${archive}/bin/node ${target}
${target} --version`;
  const installed = await withTimeout(
    sandbox.runCommand({ cmd: "sh", args: ["-c", script] }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    "Node.js prerequisite install"
  );
  const [stdout, stderr] = await Promise.all([
    installed.stdout(),
    installed.stderr(),
  ]);
  const installLog = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (installed.exitCode !== 0 || !stdout.trim().endsWith(`v${version}`)) {
    throw new SandboxBootstrapError(
      `Runtime prerequisite failed (Node.js ${version})`,
      { installLog, previewUrl }
    );
  }
  return installLog;
}
