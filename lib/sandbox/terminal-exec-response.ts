export type TerminalImmediateExecResponse = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  cwd?: string;
  error?: string;
};

export const TERMINAL_EXEC_MODE_HEADER = "x-mogplex-exec-mode";
export const TERMINAL_EXEC_MODE_IMMEDIATE = "immediate";

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeExitCode(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function readTerminalExecImmediateResponse(
  response: Response
): Promise<TerminalImmediateExecResponse | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) {
    return null;
  }

  const execMode =
    response.headers.get(TERMINAL_EXEC_MODE_HEADER)?.toLowerCase() ?? "";
  const isJsonResponse = contentType.includes("application/json");
  const isImmediateResponse =
    execMode === TERMINAL_EXEC_MODE_IMMEDIATE || isJsonResponse || !response.ok;

  if (!isImmediateResponse) {
    return null;
  }

  const rawText = await response.text();
  let payload: Record<string, unknown> | null = null;

  if (rawText.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (parsed && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
  }

  return {
    exitCode: normalizeExitCode(payload?.exitCode),
    stdout: typeof payload?.stdout === "string" ? payload.stdout : "",
    stderr: typeof payload?.stderr === "string" ? payload.stderr : "",
    cwd: normalizeOptionalString(payload?.cwd),
    error:
      normalizeOptionalString(payload?.error) ??
      (response.ok
        ? undefined
        : (normalizeOptionalString(rawText) ??
          `exec failed (${response.status})`)),
  };
}
