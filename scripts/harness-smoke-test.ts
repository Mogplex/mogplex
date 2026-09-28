import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HARNESSES, type HarnessConfig } from "../lib/harness/config";
import { buildAcpAgentEnv, buildAcpRunConfig } from "../lib/harness/acp/launch";
import { ACP_BRIDGE_SCRIPT } from "../lib/harness/acp/bridge-script";
import { parseAcpBridgeLine } from "../lib/harness/acp/protocol";

// Smoke test for the pinned harness CLI packages. CI proves a pin bump
// compiles, but nothing executed the new binaries before they reached
// production sandboxes — an upstream release that breaks headless invocation
// would only surface at job runtime. This script installs each pinned
// package, asserts the binary reports the pinned version, and (when the
// harness's API key env var is present) checks both the exact production resume
// invocation and a fresh `buildCommand` invocation. The sync workflow runs it
// after refreshing pins and before opening the PR.

const SMOKE_PROMPT = "Reply with exactly: OK";
const MISSING_SESSION_ID = "00000000-0000-4000-8000-000000000000";
const EXPECTED_MISSING_SESSION_PATTERNS: Record<HarnessConfig["id"], RegExp> = {
  "claude-code": new RegExp(
    `\\bno conversation found with session id:\\s*${MISSING_SESSION_ID}\\b`,
    "i"
  ),
  codex: new RegExp(
    `\\bno rollout found for thread id\\s+${MISSING_SESSION_ID}\\b`,
    "i"
  ),
};
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const VERSION_TIMEOUT_MS = 60 * 1000;
const RESUME_TIMEOUT_MS = 60 * 1000;
const PROMPT_TIMEOUT_MS = 3 * 60 * 1000;

type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; cwd: string; env?: NodeJS.ProcessEnv }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function summarizeOutput(result: RunResult): string {
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  return combined.length > 2000
    ? `${combined.slice(0, 2000)}\n... (truncated)`
    : combined;
}

class SmokeFailure extends Error {}

async function createSmokeWorkspace(prefix: string): Promise<string> {
  const workspace = path.join(prefix, "workspace");
  await mkdir(workspace);

  // Codex refuses `exec` outside a trusted repository. Production harnesses
  // run in cloned repos, so initialize the same boundary inside the isolated
  // smoke workspace rather than adding a test-only production flag.
  const gitInit = await run("git", ["init", "--quiet"], {
    timeoutMs: VERSION_TIMEOUT_MS,
    cwd: workspace,
  });
  if (gitInit.timedOut || gitInit.code !== 0) {
    throw new SmokeFailure(
      `Failed to initialize smoke workspace (code ${gitInit.code}, timedOut ${gitInit.timedOut}):\n${summarizeOutput(gitInit)}`
    );
  }

  return workspace;
}

async function smokeTestResumeCommand(
  harness: HarnessConfig,
  binPath: string,
  workspace: string
): Promise<void> {
  // A deliberately absent session fails before any model request. Keep this
  // assertion narrower than the runtime recovery heuristic: parser, usage, or
  // auth errors must not masquerade as a compatible resume command.
  const { args } = harness.buildCommand(SMOKE_PROMPT, {
    resumeSessionId: MISSING_SESSION_ID,
  });
  console.log(
    `[${harness.id}] validating resume command: ${harness.binary} ${args.join(" ")}`
  );
  const result = await run(binPath, args, {
    timeoutMs: RESUME_TIMEOUT_MS,
    cwd: workspace,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (
    result.timedOut ||
    result.code === 0 ||
    !EXPECTED_MISSING_SESSION_PATTERNS[harness.id].test(output)
  ) {
    throw new SmokeFailure(
      `[${harness.id}] resume command did not return the expected missing-session error (code ${result.code}, timedOut ${result.timedOut}):\n${summarizeOutput(result)}`
    );
  }
  console.log(`[${harness.id}] resume command shape passed`);
}

async function smokeTestFreshPrompt(
  harness: HarnessConfig,
  binPath: string,
  workspace: string
): Promise<void> {
  // Run the exact args production sandboxes use, substituting only the binary
  // path for the bare binary name.
  const { args } = harness.buildCommand(SMOKE_PROMPT);
  console.log(
    `[${harness.id}] running headless prompt: ${harness.binary} ${args.join(" ")}`
  );
  const prompt = await run(binPath, args, {
    timeoutMs: PROMPT_TIMEOUT_MS,
    cwd: workspace,
  });
  if (prompt.timedOut || prompt.code !== 0) {
    throw new SmokeFailure(
      `[${harness.id}] headless prompt run failed (code ${prompt.code}, timedOut ${prompt.timedOut}):\n${summarizeOutput(prompt)}`
    );
  }
  if (prompt.stdout.trim().length === 0) {
    throw new SmokeFailure(
      `[${harness.id}] headless prompt run exited 0 but produced no stdout:\n${summarizeOutput(prompt)}`
    );
  }
  console.log(`[${harness.id}] headless prompt run passed`);
}

async function installPackage(
  label: string,
  spec: string,
  prefix: string,
  workspace: string
) {
  console.log(`[${label}] installing ${spec}`);
  const install = await run(
    "npm",
    [
      "install",
      "--prefix",
      prefix,
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
      spec,
    ],
    { timeoutMs: INSTALL_TIMEOUT_MS, cwd: workspace }
  );
  if (install.timedOut || install.code !== 0) {
    throw new SmokeFailure(
      `[${label}] npm install ${spec} failed (code ${install.code}, timedOut ${install.timedOut}):\n${summarizeOutput(install)}`
    );
  }
}

/**
 * Production runs this harness through its ACP agent behind the bridge, so
 * run the same bridge against the pinned agent: one turn that also asks to
 * resume an absent session, which must fall back to a fresh one.
 */
async function smokeTestAcpAgent(harness: HarnessConfig): Promise<void> {
  const agent = harness.acp;
  if (!agent) return;
  const label = `${harness.id} acp`;
  const prefix = await mkdtemp(
    path.join(tmpdir(), `harness-smoke-${harness.id}-acp-`)
  );
  try {
    const workspace = await createSmokeWorkspace(prefix);
    await installPackage(
      label,
      `${agent.package}@${agent.version}`,
      prefix,
      workspace
    );
    const binPath = path.join(prefix, "node_modules", ".bin", agent.binary);
    if (!process.env[harness.envVar]?.trim()) {
      console.log(
        `[${label}] SKIP prompt check: ${harness.envVar} is not set (install only)`
      );
      return;
    }

    // A gateway key needs its base URL; a direct key signs in to the provider.
    const env: Record<string, string> = {
      [harness.envVar]: process.env[harness.envVar] ?? "",
      ...(process.env.OPENAI_BASE_URL
        ? { OPENAI_BASE_URL: process.env.OPENAI_BASE_URL }
        : {}),
    };
    const config = buildAcpRunConfig({
      harnessId: harness.id,
      agent: { ...agent, binary: binPath },
      prompt: SMOKE_PROMPT,
      cwd: workspace,
      mode: "SAFE",
      resumeSessionId: MISSING_SESSION_ID,
      env,
    });
    // Keep the smoke's Codex state out of the runner's home directory.
    const codexHome = path.join(prefix, "codex-home");
    await mkdir(codexHome);
    const bridgePath = path.join(prefix, "acp-bridge.mjs");
    const runPath = path.join(prefix, "acp-run.json");
    await writeFile(bridgePath, ACP_BRIDGE_SCRIPT);
    await writeFile(runPath, JSON.stringify(config));
    console.log(`[${label}] running one ACP turn through the bridge`);
    const result = await run(process.execPath, [bridgePath, runPath], {
      timeoutMs: PROMPT_TIMEOUT_MS,
      cwd: workspace,
      env: {
        ...process.env,
        ...buildAcpAgentEnv(harness.id, env, "SAFE"),
        CODEX_HOME: codexHome,
      },
    });
    const events = result.stdout.split("\n").map(parseAcpBridgeLine);
    const done = events.find((event) => event?.type === "done");
    const fellBack = events.some((event) => event?.type === "resume_failed");
    if (
      result.timedOut ||
      result.code !== 0 ||
      done?.type !== "done" ||
      done.stopReason !== "end_turn" ||
      !fellBack
    ) {
      throw new SmokeFailure(
        `[${label}] bridge turn failed (code ${result.code}, timedOut ${result.timedOut}, resume fallback ${fellBack}):\n${summarizeOutput(result)}`
      );
    }
    console.log(`[${label}] bridge turn passed`);
  } finally {
    // Codex may still be flushing session files as it exits.
    await rm(prefix, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

async function smokeTestHarness(harness: HarnessConfig): Promise<void> {
  const prefix = await mkdtemp(
    path.join(tmpdir(), `harness-smoke-${harness.id}-`)
  );
  try {
    // Every harness process runs inside this empty temp workspace, never the
    // repo checkout. The production Claude args grant edit/write tools, and
    // the sync workflow commits whatever is in the checkout after this
    // script — a stray file written here must not ride along with the pin
    // bump PR.
    const workspace = await createSmokeWorkspace(prefix);

    await installPackage(
      harness.id,
      `${harness.package}@${harness.version}`,
      prefix,
      workspace
    );

    const binPath = path.join(prefix, "node_modules", ".bin", harness.binary);

    const version = await run(binPath, ["--version"], {
      timeoutMs: VERSION_TIMEOUT_MS,
      cwd: workspace,
    });
    const versionOutput = `${version.stdout}\n${version.stderr}`;
    if (
      version.timedOut ||
      version.code !== 0 ||
      !versionOutput.includes(harness.version)
    ) {
      throw new SmokeFailure(
        `[${harness.id}] ${harness.binary} --version did not report ${harness.version} (code ${version.code}, timedOut ${version.timedOut}):\n${summarizeOutput(version)}`
      );
    }
    console.log(`[${harness.id}] binary reports pinned version`);

    if (!process.env[harness.envVar]?.trim()) {
      console.log(
        `[${harness.id}] SKIP command checks: ${harness.envVar} is not set (install + version only)`
      );
      return;
    }

    await smokeTestResumeCommand(harness, binPath, workspace);
    await smokeTestFreshPrompt(harness, binPath, workspace);
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const failures: string[] = [];
  for (const harness of Object.values(HARNESSES)) {
    try {
      await smokeTestHarness(harness);
      await smokeTestAcpAgent(harness);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      failures.push(message);
      console.error(message);
    }
  }

  if (failures.length > 0) {
    console.error(
      `Harness smoke test failed for ${failures.length} harness(es).`
    );
    return 1;
  }
  console.log("Harness smoke test passed.");
  return 0;
}

// eslint-disable-next-line unicorn/prefer-top-level-await
void main().then((code) => {
  process.exitCode = code;
});
