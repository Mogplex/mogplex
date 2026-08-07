import type { Sandbox } from "@vercel/sandbox";
import { buildRuntimeSandboxEnv } from "@/lib/repo-settings";
import { computeLockfileHashFromSandbox } from "@/lib/sandbox/lockfile-hash";
import { BaselineSnapshotRestoreError } from "@/lib/sandbox/baseline-errors";
import type { SandboxBootstrapStreamEvent } from "@/lib/sandbox/events";
import type {
  ResolvedBootstrapContext,
  BaselineSnapshotBootstrapOpts,
} from "./client-types";
import { withTimeout, BOOTSTRAP_STEP_TIMEOUT_MS } from "./client-validation";
import { buildShellCommand, shellQuote } from "./client-shell";
import { resolveBootstrapContext } from "./client-bootstrap-context";
import {
  launchDetachedDevCommand,
  streamCommandPhase,
  streamPreviewSignal,
} from "./client-bootstrap-phases";

async function runShellInSandbox(
  sandbox: Sandbox,
  command: string,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>,
  rootDir: string | null,
  label: string
): Promise<{ stdout: string; stderr: string }> {
  const result = await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildShellCommand(command, rootDir)],
      env: runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    label
  );
  const [stdout, stderr] = await Promise.all([
    result.stdout(),
    result.stderr(),
  ]);
  if (result.exitCode !== 0) {
    const tail = [stdout, stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${label} failed (exit ${result.exitCode}): ${tail}`);
  }
  return { stdout, stderr };
}

async function* runBaselineFetchPhase(
  sandbox: Sandbox,
  context: ResolvedBootstrapContext,
  opts: BaselineSnapshotBootstrapOpts
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const fetchRefs = opts.createBranch
    ? [opts.baseBranch]
    : [opts.baseBranch, opts.workingBranch];
  const fetchCommand = `git fetch --depth=1 origin ${fetchRefs
    .map(shellQuote)
    .join(" ")}`;
  try {
    const fetchResult = await runShellInSandbox(
      sandbox,
      fetchCommand,
      context.runtimeEnv,
      context.normalizedRoot,
      `git fetch ${fetchRefs.join(",")}`
    );
    if (fetchResult.stdout) {
      yield { type: "log", phase: "install", data: fetchResult.stdout };
    }
  } catch (error) {
    throw new BaselineSnapshotRestoreError(
      error instanceof Error ? error.message : "git fetch failed",
      "fetch",
      error
    );
  }
}

async function* runBaselineCheckoutPhase(
  sandbox: Sandbox,
  context: ResolvedBootstrapContext,
  opts: BaselineSnapshotBootstrapOpts
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const checkoutCommand = opts.createBranch
    ? `git checkout -b ${shellQuote(opts.workingBranch)} origin/${shellQuote(
        opts.baseBranch
      )} && git push -u origin ${shellQuote(opts.workingBranch)}`
    : `git checkout -B ${shellQuote(opts.workingBranch)} origin/${shellQuote(
        opts.workingBranch
      )}`;
  try {
    const checkoutResult = await runShellInSandbox(
      sandbox,
      checkoutCommand,
      context.runtimeEnv,
      context.normalizedRoot,
      `git checkout ${opts.workingBranch}`
    );
    if (checkoutResult.stdout) {
      yield { type: "log", phase: "install", data: checkoutResult.stdout };
    }
  } catch (error) {
    throw new BaselineSnapshotRestoreError(
      error instanceof Error ? error.message : "git checkout failed",
      "checkout",
      error
    );
  }
}

async function* runBaselineConditionalInstallPhase(
  sandbox: Sandbox,
  context: ResolvedBootstrapContext,
  expectedLockfileHash: string
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const postCheckoutHash = await computeLockfileHashFromSandbox(
    sandbox,
    context.normalizedRoot
  );
  if (!postCheckoutHash || postCheckoutHash.hash === expectedLockfileHash) {
    return;
  }

  yield {
    type: "log",
    phase: "install",
    data: `Lockfile drift detected after checkout — running ${context.installCommand}\n`,
  };
  const installCmd = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(context.installCommand, context.installDir),
    ],
    env: context.runtimeEnv,
    detached: true,
  });
  const installLog = yield* streamCommandPhase(installCmd, "install");
  const installResult = await installCmd.wait();
  if (installResult.exitCode !== 0) {
    throw new BaselineSnapshotRestoreError(
      `Install failed (${context.installCommand})`,
      "install",
      installLog
    );
  }
}

async function* runBaselineDevPhase(
  sandbox: Sandbox,
  context: ResolvedBootstrapContext
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  if (!context.hasDevScript) {
    yield {
      type: "log",
      phase: "dev",
      data: "Snapshot restored — no dev script found. Ready for terminal and file access.\n",
    };
    yield { type: "preview_url", url: context.previewUrl };
    yield { type: "status", status: "running" };
    return;
  }

  const devLaunch = await launchDetachedDevCommand(
    sandbox,
    context.normalizedRoot,
    context.devCommand,
    context.runtimeEnv
  );
  yield { type: "preview_url", url: context.previewUrl };
  yield* streamPreviewSignal(
    sandbox,
    devLaunch,
    context.previewUrl,
    context.devLogPath,
    context.readiness
  );
  yield { type: "status", status: "running" };
}

/**
 * Bootstrap a sandbox that was restored from a baseline snapshot.
 *
 * Unlike `bootstrapFromSnapshotStreaming` (used for manual snapshot restores),
 * this variant runs `git fetch` + `git checkout` to move the working tree to
 * `workingBranch` and only re-installs dependencies when the checked-out
 * lockfile hash diverges from the baseline. Failures during the fetch,
 * checkout, or post-checkout install raise `BaselineSnapshotRestoreError`
 * so the launch route can fall back to the git-clone path.
 */
export async function* bootstrapFromBaselineSnapshotStreaming(
  sandbox: Sandbox,
  opts: BaselineSnapshotBootstrapOpts
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const context = await resolveBootstrapContext(sandbox, opts, {
    extraPortHints: [opts.devCommand],
  });
  if (context.monorepoAutoTargetMessage) {
    yield { type: "warning", message: context.monorepoAutoTargetMessage };
  }
  if (context.vercelLinkWarning) {
    yield { type: "warning", message: context.vercelLinkWarning };
  }

  yield { type: "status", status: "installing" };
  yield* runBaselineFetchPhase(sandbox, context, opts);
  yield* runBaselineCheckoutPhase(sandbox, context, opts);
  yield* runBaselineConditionalInstallPhase(
    sandbox,
    context,
    opts.expectedLockfileHash
  );
  yield* runBaselineDevPhase(sandbox, context);
}
