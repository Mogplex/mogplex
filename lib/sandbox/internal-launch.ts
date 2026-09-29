import { SANDBOX_READINESS_WAIT_HEADER } from "@/lib/sandbox/readiness-contract";
import type { SandboxRecord } from "@/lib/types";

export type LaunchedSandbox = {
  recordId: string;
  sandboxId: string | null;
  rootDirectory: string | null;
};

type PostSandbox = (request: Request) => Promise<Response>;

const defaultPost: PostSandbox = async (request) => {
  const { createSandboxPostHandler } = await import("@/app/api/sandbox/route");
  return createSandboxPostHandler()(request);
};

/** A response's body as text, or "" when it cannot be read. */
export async function readTextResponse(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function toLaunchedSandbox(record: unknown): LaunchedSandbox | null {
  if (!record || typeof record !== "object") return null;
  const sandbox = record as Partial<SandboxRecord> & {
    runtime_summary?: { sandbox_id?: string | null };
  };
  if (typeof sandbox.id !== "string") return null;
  return {
    recordId: sandbox.id,
    sandboxId:
      typeof sandbox.sandbox_id === "string"
        ? sandbox.sandbox_id
        : (sandbox.runtime_summary?.sandbox_id ?? null),
    rootDirectory:
      typeof sandbox.root_directory === "string"
        ? sandbox.root_directory
        : null,
  };
}

function parseSseDataEvents(buffer: string) {
  const events: unknown[] = [];
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");
  while (separatorIndex !== -1) {
    const rawEvent = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      // SSE joins multiple data fields in one event with a newline.
      .join("\n");
    if (data) {
      // A malformed event is skipped; the stream's terminal event decides.
      try {
        events.push(JSON.parse(data));
      } catch {
        // Not JSON.
      }
    }
    separatorIndex = remaining.indexOf("\n\n");
  }
  return { events, remaining };
}

type ReadSandbox = { sandbox: LaunchedSandbox; ready: boolean };

async function readJsonSandbox(response: Response): Promise<ReadSandbox> {
  const payload = (await response.json()) as {
    sandbox?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Sandbox launch failed"
    );
  }
  const sandbox = toLaunchedSandbox(payload.sandbox);
  if (!sandbox) {
    throw new Error("Sandbox launch response did not include a sandbox");
  }
  // A matching record the route resumes by name can still read "paused"; the
  // harness route resumes a paused VM, so only a pending VM id is unusable.
  return { sandbox, ready: true };
}

type LaunchEvent = { type?: string; message?: string; sandbox?: unknown };

/** Fold one stream event into the sandbox seen so far; true once ready. */
function applyLaunchEvent(
  event: LaunchEvent | null,
  state: { latest: LaunchedSandbox | null }
): boolean {
  if (!event) return false;
  if (event.type === "error") {
    throw new Error(event.message || "Sandbox launch failed");
  }
  state.latest = toLaunchedSandbox(event.sandbox) ?? state.latest;
  return event.type === "ready" && state.latest !== null;
}

async function readStreamSandbox(
  body: ReadableStream<Uint8Array>
): Promise<ReadSandbox> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state: { latest: LaunchedSandbox | null } = { latest: null };
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseDataEvents(buffer);
      buffer = parsed.remaining;
      for (const event of parsed.events as Array<LaunchEvent | null>) {
        if (applyLaunchEvent(event, state) && state.latest) {
          return { sandbox: state.latest, ready: true };
        }
      }
    }
  } finally {
    // Settling early must not leave the route's stream open.
    await reader.cancel().catch(() => undefined);
  }
  if (!state.latest) {
    throw new Error("Sandbox launch stream ended before a sandbox was ready");
  }
  return { sandbox: state.latest, ready: false };
}

/**
 * Read a sandbox route response: JSON is a settled sandbox, a stream settles
 * on `ready`. A stream that closes first yields the last sandbox it named,
 * marked not ready.
 */
async function readSandboxResponse(response: Response): Promise<ReadSandbox> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json"))
    return readJsonSandbox(response);
  if (!response.ok) {
    throw new Error(
      (await readTextResponse(response)) || "Sandbox launch failed"
    );
  }
  if (!response.body) {
    throw new Error("Sandbox launch response did not include a stream");
  }
  return readStreamSandbox(response.body);
}

/**
 * The sandbox a resume or launch response settles on, ready or not. Callers
 * that need a running sandbox use `launchSandboxInternally` instead.
 */
export async function readSandboxLaunchResponse(
  response: Response
): Promise<LaunchedSandbox> {
  return (await readSandboxResponse(response)).sandbox;
}

/** Usable only once it is ready and the VM has its id. */
function usable(read: ReadSandbox): LaunchedSandbox | null {
  return read.ready &&
    read.sandbox.sandboxId &&
    read.sandbox.sandboxId !== "pending"
    ? read.sandbox
    : null;
}

/**
 * Start or reuse the repo's sandbox through the sandbox route and wait until
 * it is running. A sandbox another run is still booting is waited on rather
 * than handed back half-made; when that wait closes without a usable sandbox,
 * it reattaches once through the same route, which then reads the settled row.
 */
export async function launchSandboxInternally(input: {
  headers: HeadersInit;
  body: Record<string, unknown>;
  post?: PostSandbox;
}): Promise<LaunchedSandbox> {
  const post = input.post ?? defaultPost;
  const last: { sandbox: LaunchedSandbox | null } = { sandbox: null };
  const attach = async () => {
    const headers = new Headers(input.headers);
    headers.set(SANDBOX_READINESS_WAIT_HEADER, "1");
    const read = await readSandboxResponse(
      await post(
        new Request("https://internal.mogplex/api/sandbox", {
          method: "POST",
          headers,
          body: JSON.stringify(input.body),
        })
      )
    );
    last.sandbox = read.sandbox;
    return usable(read);
  };
  // One bounded reattach, a second full POST, when the first attach does not
  // yield a usable sandbox: the agent tool path in sandbox-resolution.ts does
  // the same.
  const sandbox = (await attach()) ?? (await attach());
  if (sandbox) return sandbox;
  // A failed launch never reaches the run row, so name the record here.
  throw new Error(
    last.sandbox
      ? `Sandbox ${last.sandbox.recordId} did not become ready`
      : "Sandbox did not become ready"
  );
}
