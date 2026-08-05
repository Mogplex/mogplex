export type HarnessFailureCode =
  | "model_access_denied"
  | "rate_limited"
  | "command_failed";

export type HarnessFailurePresentation = {
  code: HarnessFailureCode;
  message: string;
};

type HarnessFailureInput = {
  harnessId: "claude-code" | "codex";
  exitCode: number;
  output: string;
};

export function presentHarnessFailure({
  harnessId,
  exitCode,
  output,
}: HarnessFailureInput): HarnessFailurePresentation {
  const providerName = harnessId === "claude-code" ? "Anthropic" : "OpenAI";

  if (
    /no access to this model/i.test(output) ||
    /model[^\n]*(?:not available|access denied|permission)/i.test(output)
  ) {
    return {
      code: "model_access_denied",
      message: `${providerName} accepted the API key, but the model selected by ${harnessId === "claude-code" ? "Claude Code" : "Codex"} is unavailable for this account. Check model access with ${providerName}, then try again.`,
    };
  }

  if (/\b429\b|rate[ -]?limit|too many requests/i.test(output)) {
    return {
      code: "rate_limited",
      message: `${providerName} rate-limited this run. Wait a moment, then try again.`,
    };
  }

  return {
    code: "command_failed",
    message: `Agent run exited with code ${exitCode}.`,
  };
}

export function appendHarnessFailureOutput(
  current: string,
  chunk: string,
  maxCharacters = 16_000
) {
  const combined = current + chunk;
  return combined.length <= maxCharacters
    ? combined
    : combined.slice(combined.length - maxCharacters);
}
