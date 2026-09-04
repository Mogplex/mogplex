/**
 * Sandbox-launch plumbing for external agent runs: the internal HTTP calls to
 * the sandbox route and the SSE/JSON parsing of its response. Split out of
 * run-execution.ts to keep that module focused on the run lifecycle (and under
 * the file-length cap).
 */
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import type { SandboxRecord } from "@/lib/types";

export type SandboxRef = {
  recordId: string;
  sandboxId: string | null;
};

function extractSandboxRef(record: unknown): SandboxRef | null {
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
  };
}

export async function readTextResponse(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function readJsonSandboxResponse(response: Response) {
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

  const sandbox = extractSandboxRef(payload.sandbox);
  if (!sandbox) {
    throw new Error("Sandbox launch response did not include a sandbox");
  }
  return sandbox;
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
      // SSE requires multiple data fields in one event to be joined with a
      // newline before the event is dispatched.
      .join("\n");
    if (data) {
      events.push(JSON.parse(data));
    }
    separatorIndex = remaining.indexOf("\n\n");
  }
  return { events, remaining };
}

async function readSandboxStreamResponse(response: Response) {
  if (!response.body) {
    throw new Error("Sandbox launch response did not include a stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestSandbox: SandboxRef | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseDataEvents(buffer);
    buffer = parsed.remaining;

    for (const event of parsed.events) {
      if (!event || typeof event !== "object") continue;
      const typedEvent = event as {
        type?: string;
        message?: string;
        sandbox?: unknown;
      };
      if (typedEvent.type === "error") {
        throw new Error(typedEvent.message || "Sandbox launch failed");
      }
      const sandbox = extractSandboxRef(typedEvent.sandbox);
      if (sandbox) latestSandbox = sandbox;
      if (typedEvent.type === "ready" && latestSandbox) {
        return latestSandbox;
      }
    }
  }

  if (!latestSandbox) {
    throw new Error("Sandbox launch stream ended before a sandbox was ready");
  }
  return latestSandbox;
}

export async function launchSandboxViaRoute(run: ExternalAgentRunRow) {
  if (run.sandbox_record_id && run.sandbox_id && run.sandbox_id !== "pending") {
    return {
      recordId: run.sandbox_record_id,
      sandboxId: run.sandbox_id,
    };
  }

  const { createSandboxPostHandler } = await import("@/app/api/sandbox/route");
  const response = await createSandboxPostHandler()(
    new Request("https://internal.mogplex/api/sandbox", {
      method: "POST",
      headers: buildInternalApiHeaders(run.user_id),
      body: JSON.stringify({
        repoId: run.repo_id,
        baseBranch: run.base_branch,
        workingBranch: run.working_branch,
        createBranch: run.create_branch,
        rootDirectory: run.root_directory,
      }),
    })
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readJsonSandboxResponse(response);
  }
  if (!response.ok) {
    throw new Error(
      (await readTextResponse(response)) || "Sandbox launch failed"
    );
  }
  return readSandboxStreamResponse(response);
}
