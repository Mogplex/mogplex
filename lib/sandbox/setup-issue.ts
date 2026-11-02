import { redactSecretsInText } from "@/lib/ai-telemetry";
import { extractDevLogTail } from "./client-readiness";
import { SandboxBootstrapError } from "./client-validation";
import { detectMissingEnvVarHint } from "./env-var-hint";
import type { SandboxBootstrapStreamEvent, SandboxSetupIssue } from "./events";

/**
 * The boot error to record for an issue: a failed step is one, an
 * unrecognized project (`detect`) is not.
 */
export function setupFailureMessage(
  issue: SandboxSetupIssue | null | undefined
) {
  return issue && issue.phase !== "detect" ? issue.message : null;
}

/**
 * Whether a boot's setup issue means a baseline snapshot build would fail the
 * same way: dependencies never installed. A dev-server failure (installed)
 * or an unrecognized project still warms the snapshot as before.
 */
export function setupIssueSkipsSnapshotWarmup(
  issue: SandboxSetupIssue | null | undefined
) {
  return issue?.phase === "prerequisite" || issue?.phase === "install";
}

/**
 * Record fields for a boot that finished with a setup issue, shared by
 * launch, restart and resume so each keeps the same diagnosis: the failed
 * step as the boot error, its log tail, and `app_error` health. An
 * unrecognized project (`detect`) records nothing. Logs the hand-off once.
 */
export function setupIssueRecordFields(
  issue: SandboxSetupIssue | null | undefined,
  sandboxRecordId: string
) {
  const failure = setupFailureMessage(issue);
  if (!issue || !failure) return { last_boot_error: null };
  console.warn(
    `[sandbox/setup] record=${sandboxRecordId} phase=${issue.phase}: ${failure}`
  );
  return {
    last_boot_error: failure,
    health_status: "app_error" as const,
    error: null,
    ...(issue.logTail
      ? issue.phase === "dev"
        ? { dev_log: issue.logTail }
        : { install_log: issue.logTail }
      : {}),
  };
}

/** Describe a failed setup step for the agent and the launch log. */
export function setupIssueFromError(
  error: SandboxBootstrapError
): SandboxSetupIssue {
  // The tail reaches the model and the sandbox record; install and dev output
  // can echo tokens (.npmrc auth, env dumps), so redact it like exec output.
  const message = redactSecretsInText(error.message);
  const log = redactSecretsInText(error.devLog || error.installLog || "");
  return {
    phase: error.phase,
    message: message.split("\n")[0]?.trim() || "Project setup failed",
    logTail: extractDevLogTail(log),
    envVarHint: detectMissingEnvVarHint(`${message}\n${log}`),
  };
}

/**
 * Keep a boot running when a project-setup step fails. The VM is healthy, so
 * instead of failing the launch (which stops the sandbox), report the issue
 * and finish as running: the agent reads the issue from the launch stream and
 * fixes the project from inside the sandbox. Any other error still throws.
 */
export async function* handOffSetupFailures(
  stream: AsyncGenerator<SandboxBootstrapStreamEvent>
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  let previewUrlSent = false;
  try {
    for await (const event of stream) {
      if (event.type === "preview_url") previewUrlSent = true;
      yield event;
    }
  } catch (error) {
    if (!(error instanceof SandboxBootstrapError)) throw error;
    const issue = setupIssueFromError(error);
    yield {
      type: "warning",
      message:
        `Project setup did not finish (${issue.message}). The sandbox is ` +
        "still running so the agent can fix it.",
    };
    yield { type: "setup_issue", issue };
    if (!previewUrlSent && error.previewUrl) {
      yield { type: "preview_url", url: error.previewUrl };
    }
    yield { type: "status", status: "running" };
  }
}
