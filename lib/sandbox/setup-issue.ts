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

/** Describe a failed setup step for the agent and the launch log. */
export function setupIssueFromError(
  error: SandboxBootstrapError
): SandboxSetupIssue {
  const log = error.devLog || error.installLog || "";
  return {
    phase: error.phase ?? "dev",
    message: error.message.split("\n")[0] ?? error.message,
    logTail: extractDevLogTail(log),
    envVarHint: detectMissingEnvVarHint(`${error.message}\n${log}`),
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
