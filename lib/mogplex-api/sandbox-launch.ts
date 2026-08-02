import type { MogplexApiSandbox } from "@/lib/mogplex-api/sandboxes";

export type MogplexApiSandboxLaunchResult =
  | { ok: true; sandbox: MogplexApiSandbox }
  | { ok: false; status: number; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toMogplexApiSandbox(value: unknown): MogplexApiSandbox | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const repoId = readString(value.repo_id);
  if (!id || !repoId) return null;
  const runtimeSummary = isRecord(value.runtime_summary)
    ? value.runtime_summary
    : null;
  const errorSummary = isRecord(value.error_summary)
    ? value.error_summary
    : null;

  return {
    id,
    sandbox_id:
      typeof runtimeSummary?.sandbox_id === "string"
        ? runtimeSummary.sandbox_id
        : typeof value.sandbox_id === "string"
          ? value.sandbox_id
          : null,
    repo_id: repoId,
    status: readString(runtimeSummary?.status ?? value.status, "unknown"),
    base_branch: readString(value.base_branch),
    working_branch: readString(value.working_branch),
    root_directory:
      typeof value.root_directory === "string" ? value.root_directory : null,
    preview_url:
      typeof runtimeSummary?.preview_url === "string"
        ? runtimeSummary.preview_url
        : typeof value.preview_url === "string"
          ? value.preview_url
          : null,
    created_at: readString(value.created_at),
    last_active_at: readString(value.last_active_at),
    error:
      typeof errorSummary?.display_error === "string"
        ? errorSummary.display_error
        : typeof value.error === "string"
          ? value.error
          : null,
  };
}

function errorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  return typeof payload.error === "string" ? payload.error : fallback;
}

function parseSseDataFrame(frame: string) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

export async function consumeSandboxLaunchResponse(
  response: Response
): Promise<MogplexApiSandboxLaunchResult> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: errorMessage(payload, "Sandbox launch failed"),
      };
    }
    const sandbox = isRecord(payload)
      ? toMogplexApiSandbox(payload.sandbox)
      : null;
    return sandbox
      ? { ok: true, sandbox }
      : {
          ok: false,
          status: 502,
          error: "Sandbox launch returned no sandbox record",
        };
  }

  if (!response.body) {
    return { ok: false, status: 502, error: "Sandbox launch stream missing" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestSandbox: MogplexApiSandbox | null = null;
  let launchError: string | null = null;

  // Each read blocks on a stream signal from the sandbox launcher. This is a
  // single event stream consumption path, not a repeated status check.
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const event = parseSseDataFrame(frame);
      if (!isRecord(event)) continue;
      const sandbox = toMogplexApiSandbox(event.sandbox);
      if (sandbox) latestSandbox = sandbox;
      if (event.type === "error" && typeof event.message === "string") {
        launchError = event.message;
      }
    }

    if (done) break;
  }

  if (launchError) {
    return { ok: false, status: 502, error: launchError };
  }
  if (latestSandbox) return { ok: true, sandbox: latestSandbox };
  return {
    ok: false,
    status: 502,
    error: "Sandbox launch completed without a sandbox record",
  };
}
