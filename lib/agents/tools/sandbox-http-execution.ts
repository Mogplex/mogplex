import { consumeTerminalExecStream } from "@/lib/sandbox/terminal-exec-stream";
import { resolveAppBaseUrl } from "./shared";

export const EXEC_STDOUT_LIMIT = 10_000;
export const EXEC_STDERR_LIMIT = 5000;

/** Consume progress immediately so quiet commands do not wait for HTTP headers. */
export async function postSandboxExec(
  sandboxId: string,
  headers: HeadersInit,
  body: { command: string; cwd?: string }
): Promise<Response> {
  const streamHeaders = new Headers(headers);
  streamHeaders.set("Accept", "text/event-stream");
  const response = await fetch(
    `${resolveAppBaseUrl()}/api/sandbox/${sandboxId}/exec`,
    {
      method: "POST",
      headers: streamHeaders,
      body: JSON.stringify(body),
    }
  );
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    return response;

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let cwd = body.cwd;
  let error: string | undefined;
  try {
    await consumeTerminalExecStream(response, (event) => {
      switch (event.type) {
        case "log": {
          if (event.stream === "stdout")
            stdout += event.data.slice(0, EXEC_STDOUT_LIMIT - stdout.length);
          else stderr += event.data.slice(0, EXEC_STDERR_LIMIT - stderr.length);

          break;
        }
        case "done": {
          exitCode = event.exitCode;
          cwd = event.cwd;

          break;
        }
        case "error": {
          error = event.data;

          break;
        }
        case "cancelled": {
          error = "Command cancelled.";

          break;
        }
        // No default
      }
    });
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "Terminal stream failed before command completion.";
  }
  // Observation failures are not sandbox-loss responses: never recreate the
  // sandbox or replay a command whose effects may already have happened.
  return error === undefined
    ? Response.json({ stdout, stderr, exitCode, cwd })
    : Response.json({ error }, { status: 500 });
}
