import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPendingSandboxWaitStreamResponse } from "@/app/api/sandbox/_lib/pending-stream";
import { maybeReturnExistingSandboxResponse } from "@/app/api/sandbox/_lib/launch";
import type { SandboxRecordRow } from "@/lib/types";

const record = {
  id: "sandbox-record-1",
  user_id: "user-1",
  repo_id: "repo-1",
  sandbox_id: "sandbox-runtime-1",
  base_branch: "main",
  working_branch: "main",
  limit_claim_id: null,
  status: "installing",
  preview_url: null,
  snapshot_id: null,
  error: null,
  created_at: "2026-08-20T12:00:00.000Z",
  last_active_at: "2026-08-20T12:00:00.000Z",
} satisfies SandboxRecordRow;

describe("pending sandbox readiness stream", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the readiness stream for an internal pending reuse", async () => {
    const response = await maybeReturnExistingSandboxResponse(
      {
        getActiveSandboxForRepo: async () => record,
        resolveActiveSandboxState: async () => ({ kind: "pending" }),
        waitForSandboxReadiness: async () => ({
          kind: "ready",
          snapshot: {
            id: record.id,
            user_id: "user-1",
            status: "running",
          },
        }),
      } as never,
      {
        repoId: "repo-1",
        creds: { userId: "user-1" },
        launchRequest: { workingBranch: "main" },
        effectiveRootDirectory: null,
        productTeamId: null,
      } as never,
      new Request("http://localhost/api/sandbox", {
        headers: { Accept: "text/event-stream, application/json" },
      })
    );

    expect(response?.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await response?.text()).toContain('"type":"ready"');
  });

  it("holds a reused launch open until Neon reports it ready", async () => {
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => ({
        kind: "ready",
        snapshot: {
          id: record.id,
          user_id: "user-1",
          status: "running",
          health_status: "running",
          preview_url: "https://preview.example",
        },
      }),
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"type":"sandbox_created"');
    expect(body).toContain('"type":"ready"');
    expect(body).toContain('"status":"running"');
  });

  it("emits an error instead of readiness when the sandbox stops", async () => {
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => ({
        kind: "failed",
        message: "Sandbox stopped before it became ready.",
      }),
    });

    const body = await response.text();
    expect(body).toContain('"type":"error"');
    expect(body).not.toContain('"type":"ready"');
  });

  it("keeps readiness exceptions private while returning a safe error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => {
        throw new Error("private database detail");
      },
    });

    const body = await response.text();
    expect(body).toContain("Failed to wait for sandbox readiness.");
    expect(body).not.toContain("private database detail");
    expect(log).toHaveBeenCalledWith(
      "[sandbox] readiness wait failed",
      expect.any(Error)
    );
  });

  it("emits transport keepalives while readiness remains event-driven", async () => {
    vi.useFakeTimers();
    let reportReady!: (result: {
      kind: "ready";
      snapshot: { id: string; user_id: string; status: string };
    }) => void;
    const readiness = new Promise<{
      kind: "ready";
      snapshot: { id: string; user_id: string; status: string };
    }>((resolve) => {
      reportReady = resolve;
    });
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => readiness,
    });
    const reader = response.body!.getReader();

    await reader.read();
    const heartbeat = reader.read();
    await vi.advanceTimersByTimeAsync(25_000);
    const chunk = await heartbeat;

    expect(new TextDecoder().decode(chunk.value)).toBe(": ping\n\n");
    reportReady({
      kind: "ready",
      snapshot: { id: record.id, user_id: "user-1", status: "running" },
    });
    await reader.cancel();
  });
});
