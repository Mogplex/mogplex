import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createStartSandbox,
  createStopSandbox,
  createWriteFile,
} from "./sandbox";

const originalFetch = global.fetch;
const originalSecret = process.env.INTERNAL_API_SECRET;
const REPO_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = "internal-secret";
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = originalSecret;
});

describe("sandbox tool failure telemetry", () => {
  it("classifies sandbox start auth and availability failures", async () => {
    delete process.env.INTERNAL_API_SECRET;
    const unauthorized = createStartSandbox("user-1") as unknown as {
      execute: (input: { repoId: string }) => Promise<unknown>;
    };
    await expect(
      unauthorized.execute({ repoId: REPO_ID })
    ).resolves.toMatchObject({ reason: "auth_unavailable" });

    process.env.INTERNAL_API_SECRET = "internal-secret";
    const unavailable = createStartSandbox() as unknown as {
      execute: (input: { repoId: string }) => Promise<unknown>;
    };
    await expect(unavailable.execute({ repoId: REPO_ID })).resolves.toEqual({
      error: "Failed to start sandbox",
      reason: "sandbox_unavailable",
    });
  });

  it("classifies sandbox stop auth and stale-record failures", async () => {
    delete process.env.INTERNAL_API_SECRET;
    const unauthorized = createStopSandbox("user-1") as unknown as {
      execute: (input: { sandboxId: string }) => Promise<unknown>;
    };
    await expect(
      unauthorized.execute({ sandboxId: "sandbox-stale" })
    ).resolves.toMatchObject({ reason: "auth_unavailable" });

    process.env.INTERNAL_API_SECRET = "internal-secret";
    global.fetch = async () =>
      Response.json({ error: "Sandbox not found" }, { status: 404 });
    const stale = createStopSandbox("user-1") as unknown as {
      execute: (input: { sandboxId: string }) => Promise<unknown>;
    };
    await expect(
      stale.execute({ sandboxId: "sandbox-stale" })
    ).resolves.toEqual({
      error: "Sandbox not found",
      reason: "sandbox_not_found",
    });
  });

  it("rejects a stop identifier outside server-selected context", async () => {
    let fetched = false;
    global.fetch = async () => {
      fetched = true;
      return Response.json({});
    };
    const tool = createStopSandbox("user-1", "sandbox-selected") as unknown as {
      execute: (input: { sandboxId: string }) => Promise<unknown>;
    };

    await expect(
      tool.execute({ sandboxId: "sandbox-injected" })
    ).resolves.toEqual({
      error:
        "The requested sandbox is not the server-selected sandbox for this session.",
      reason: "sandbox_mismatch",
    });
    expect(fetched).toBe(false);
  });

  it("clears a mutable session binding after a confirmed stop", async () => {
    const binding = {
      sandboxId: "sandbox-selected",
      status: "running" as const,
    };
    global.fetch = async () =>
      Response.json({
        sandbox: {
          id: "sandbox-selected",
          runtime_summary: { status: "stopped" },
        },
      });
    const tool = createStopSandbox("user-1", binding) as unknown as {
      execute: (input: { sandboxId: string }) => Promise<unknown>;
    };

    await expect(
      tool.execute({ sandboxId: "sandbox-selected" })
    ).resolves.toMatchObject({ ok: true, status: "stopped" });
    expect(binding).toEqual({ sandboxId: null, status: "unavailable" });
  });

  it("classifies delegated-auth and write failures", async () => {
    delete process.env.INTERNAL_API_SECRET;
    const unauthorized = createWriteFile(
      "user-1",
      "sandbox-selected"
    ) as unknown as {
      execute: (input: { path: string; content: string }) => Promise<unknown>;
    };
    await expect(
      unauthorized.execute({ path: "src/a.ts", content: "export {};" })
    ).resolves.toMatchObject({ reason: "auth_unavailable" });

    process.env.INTERNAL_API_SECRET = "internal-secret";
    global.fetch = async () =>
      Response.json({ error: "write rejected" }, { status: 500 });
    const rejected = createWriteFile(
      "user-1",
      "sandbox-selected"
    ) as unknown as {
      execute: (input: { path: string; content: string }) => Promise<unknown>;
    };
    await expect(
      rejected.execute({ path: "src/a.ts", content: "export {};" })
    ).resolves.toEqual({
      error: "write rejected",
      reason: "operation_failed",
    });
  });
});
