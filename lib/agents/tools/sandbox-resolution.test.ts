import { describe, expect, it } from "vitest";
import {
  installSandboxRows,
  OWNED_REPO_ID,
} from "../../../tests/support/sandbox-resolution-fixture";
import {
  createStartSandbox,
  createTerminalExec,
  createWriteFile,
} from "./sandbox";
import { resolveOrCreateSandbox } from "./sandbox-resolution";

describe("sandbox resolution contract", () => {
  for (const status of ["stopped", "paused"]) {
    it(`resumes the selected ${status} workspace and waits for ready`, async () => {
      installSandboxRows([{ id: "saved", status, persistent: true }]);
      const requests: string[] = [];
      global.fetch = async (url) => {
        requests.push(String(url));
        return new Response(
          [
            'data: {"type":"sandbox_created","recordId":"saved"}\n\n',
            'data: {"type":"ready","sandbox":{"id":"saved","status":"running"}}\n\n',
          ].join(""),
          { headers: { "Content-Type": "text/event-stream" } }
        );
      };
      expect(
        await resolveOrCreateSandbox("user-1", OWNED_REPO_ID, "saved")
      ).toEqual({ sandboxId: "saved", status: "running", source: "selected" });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatch(/\/api\/sandbox\/saved\/resume$/);
    });
  }

  it("does not replace saved work when resume fails or returns another identity", async () => {
    for (const response of [
      Response.json({ error: "Snapshot unavailable" }, { status: 502 }),
      Response.json({ sandbox: { id: "replacement", status: "running" } }),
    ]) {
      installSandboxRows([
        { id: "saved", status: "stopped", persistent: true },
      ]);
      const requests: string[] = [];
      global.fetch = async (url) => {
        requests.push(String(url));
        return response;
      };
      expect(
        await resolveOrCreateSandbox("user-1", OWNED_REPO_ID, "saved")
      ).toMatchObject({ reason: "sandbox_unavailable" });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatch(/\/saved\/resume$/);
    }
  });

  it("uses an owned running selected sandbox", async () => {
    installSandboxRows([{ id: "sandbox-selected" }]);
    expect(
      await resolveOrCreateSandbox(
        "user-1",
        "00000000-0000-4000-8000-000000000001",
        "sandbox-selected"
      )
    ).toEqual({
      sandboxId: "sandbox-selected",
      status: "running",
      source: "selected",
    });
  });

  it("rejects a selected sandbox outside the owned running inventory", async () => {
    await expect(
      resolveOrCreateSandbox(
        "user-1",
        "00000000-0000-4000-8000-000000000001",
        "sandbox-unavailable"
      )
    ).resolves.toEqual({
      error: "The selected sandbox is unavailable.",
      reason: "sandbox_unavailable",
    });
  });

  it("reuses exactly one repo-scoped running sandbox", async () => {
    installSandboxRows([{ id: "sandbox-1" }]);
    expect(
      await resolveOrCreateSandbox(
        "user-1",
        "00000000-0000-4000-8000-000000000001"
      )
    ).toEqual({
      sandboxId: "sandbox-1",
      status: "running",
      source: "reused_running",
    });
  });

  it("fails closed when multiple repo sandboxes are running", async () => {
    installSandboxRows([{ id: "sandbox-1" }, { id: "sandbox-2" }]);
    expect(
      await resolveOrCreateSandbox(
        "user-1",
        "00000000-0000-4000-8000-000000000001"
      )
    ).toEqual({
      error:
        "Multiple running sandboxes are available for this repository. Call start_sandbox with one of the listed sandboxId values. Use the branch and directory to identify the intended workspace; ask the user if it is unclear. Keep the other sandboxes running.",
      reason: "multiple_sandboxes",
      sandboxes: [{ id: "sandbox-1" }, { id: "sandbox-2" }],
    });
  });

  it("starts missing repo compute and parses a reused JSON response", async () => {
    global.fetch = async () =>
      Response.json(
        {
          sandbox: {
            id: "sandbox-new",
            runtime_summary: { status: "running" },
          },
        },
        { headers: { "Content-Type": "application/json" } }
      );

    expect(
      await resolveOrCreateSandbox(
        "user-1",
        "00000000-0000-4000-8000-000000000001"
      )
    ).toEqual({
      sandboxId: "sandbox-new",
      status: "running",
      source: "reused_running",
    });
  });

  it("surfaces the provider transition conflict from sandbox start", async () => {
    global.fetch = async () =>
      Response.json(
        {
          error:
            "Mogplex must finish cleanup for the previous sandbox. Start it again in a moment.",
          code: "sandbox_transition_in_progress",
        },
        { status: 409 }
      );

    await expect(
      resolveOrCreateSandbox("user-1", "00000000-0000-4000-8000-000000000001")
    ).resolves.toEqual({
      error:
        "Mogplex must finish cleanup for the previous sandbox. Start it again in a moment.",
      reason: "sandbox_unavailable",
    });
  });

  it("rejects missing or unowned repository context", async () => {
    await expect(resolveOrCreateSandbox()).resolves.toBeNull();
    await expect(resolveOrCreateSandbox("user-1")).resolves.toBeNull();
    installSandboxRows([], null);
    await expect(
      resolveOrCreateSandbox("user-1", "acme/missing")
    ).resolves.toEqual({
      error: "Repository not found for this user.",
      reason: "repo_mismatch",
    });
    await expect(
      resolveOrCreateSandbox("user-1", OWNED_REPO_ID)
    ).resolves.toEqual({
      error: "Repository not found for this user.",
      reason: "repo_mismatch",
    });
  });

  it("distinguishes repository lookup failures from ownership mismatches", async () => {
    installSandboxRows([], null, { message: "database unavailable" });
    await expect(
      resolveOrCreateSandbox("user-1", "acme/unavailable")
    ).resolves.toEqual({
      error: "Repository lookup failed. Try again.",
      reason: "repo_lookup_failed",
    });
  });

  it("surfaces delegated-auth configuration failures", async () => {
    delete process.env.INTERNAL_API_SECRET;
    await expect(
      resolveOrCreateSandbox("user-1", "00000000-0000-4000-8000-000000000001")
    ).resolves.toEqual({
      error: "INTERNAL_API_SECRET is required for delegated internal API calls",
      reason: "auth_unavailable",
    });
  });
});

describe("sandbox command tool contract", () => {
  it("classifies missing repository context without attempting execution", async () => {
    const tool = createTerminalExec(undefined, "user-1") as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };
    await expect(tool.execute({ command: "pwd" })).resolves.toEqual({
      error: "No sandbox available. Select a repository first.",
      reason: "repo_not_selected",
      command: "pwd",
    });
  });

  it("surfaces delegated-auth failures instead of blaming repo selection", async () => {
    delete process.env.INTERNAL_API_SECRET;
    let fetched = false;
    global.fetch = async () => {
      fetched = true;
      return Response.json({ exitCode: 0 });
    };
    const tool = createTerminalExec(
      undefined,
      "user-1",
      "00000000-0000-4000-8000-000000000001"
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await expect(tool.execute({ command: "pwd" })).resolves.toEqual({
      error: "INTERNAL_API_SECRET is required for delegated internal API calls",
      reason: "auth_unavailable",
      command: "pwd",
    });
    expect(fetched).toBe(false);
  });

  it("returns selected sandbox identity on success and failure", async () => {
    let status = 200;
    global.fetch = async () =>
      status === 200
        ? Response.json({ exitCode: 0, stdout: "ok", stderr: "" })
        : Response.json({ error: "rejected" }, { status });
    const tool = createTerminalExec("sandbox-1", "user-1") as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await expect(tool.execute({ command: "true" })).resolves.toMatchObject({
      exitCode: 0,
      sandboxId: "sandbox-1",
      sandboxResolution: "selected",
    });
    status = 500;
    await expect(tool.execute({ command: "false" })).resolves.toMatchObject({
      error: "rejected",
      sandboxId: "sandbox-1",
      sandboxResolution: "selected",
    });
  });

  it("returns ambiguity without executing a command", async () => {
    installSandboxRows([{ id: "sandbox-1" }, { id: "sandbox-2" }]);
    let fetched = false;
    global.fetch = async () => {
      fetched = true;
      return Response.json({ exitCode: 0 });
    };
    const tool = createTerminalExec(
      undefined,
      "user-1",
      "00000000-0000-4000-8000-000000000001"
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await expect(tool.execute({ command: "pwd" })).resolves.toMatchObject({
      error: expect.stringContaining("Call start_sandbox"),
    });
    expect(fetched).toBe(false);
  });

  it("returns the started sandbox identity from sandbox_start", async () => {
    global.fetch = async () =>
      Response.json(
        {
          sandbox: {
            id: "sandbox-new",
            runtime_summary: { status: "running" },
          },
        },
        { headers: { "Content-Type": "application/json" } }
      );
    const tool = createStartSandbox("user-1") as unknown as {
      execute: (input: { repoId: string }) => Promise<unknown>;
    };
    await expect(
      tool.execute({ repoId: "00000000-0000-4000-8000-000000000001" })
    ).resolves.toMatchObject({
      ok: true,
      sandboxId: "sandbox-new",
      status: "running",
    });
  });

  it("uses the server-selected repository without model input", async () => {
    const repoId = "00000000-0000-4000-8000-000000000001";
    let requestBody: unknown;
    global.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json(
        {
          sandbox: {
            id: "sandbox-server-scoped",
            runtime_summary: { status: "running" },
          },
        },
        { headers: { "Content-Type": "application/json" } }
      );
    };
    const tool = createStartSandbox("user-1", repoId) as unknown as {
      inputSchema: { shape: Record<string, unknown> };
      execute: (input: Record<string, never>) => Promise<unknown>;
    };

    expect(Object.keys(tool.inputSchema.shape)).toEqual(["sandboxId"]);
    await expect(tool.execute({})).resolves.toMatchObject({
      ok: true,
      sandboxId: "sandbox-server-scoped",
    });
    expect(requestBody).toMatchObject({ repoId });
  });
  it("does not resurrect a dead selected sandbox after re-resolution fails", async () => {
    const urls: string[] = [];
    global.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/sandbox-old/exec")) {
        return Response.json({ error: "old sandbox missing" }, { status: 404 });
      }
      return Response.json({ error: "start failed" }, { status: 500 });
    };
    const tool = createTerminalExec(
      "sandbox-old",
      "user-1",
      "00000000-0000-4000-8000-000000000001"
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await tool.execute({ command: "pwd" });
    installSandboxRows([{ id: "sandbox-new" }]);
    global.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      return Response.json({ exitCode: 0, stdout: "ok", stderr: "" });
    };

    await expect(tool.execute({ command: "pwd" })).resolves.toMatchObject({
      sandboxId: "sandbox-new",
      sandboxResolution: "reused_running",
    });
    expect(
      urls.filter((url) => url.endsWith("/sandbox-old/exec"))
    ).toHaveLength(1);
  });

  it("reports the retry response against the newly resolved sandbox", async () => {
    installSandboxRows([{ id: "sandbox-new" }]);
    global.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/sandbox-old/exec")) {
        return Response.json({ error: "old sandbox missing" }, { status: 404 });
      }
      return Response.json({ error: "new command rejected" }, { status: 500 });
    };
    const tool = createTerminalExec(
      "sandbox-old",
      "user-1",
      "00000000-0000-4000-8000-000000000001"
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await expect(tool.execute({ command: "pwd" })).resolves.toMatchObject({
      error: "new command rejected",
      sandboxId: "sandbox-new",
      sandboxResolution: "reused_running",
    });
  });

  it("surfaces a re-resolution auth failure after a selected sandbox disappears", async () => {
    global.fetch = async () => {
      delete process.env.INTERNAL_API_SECRET;
      return Response.json({ error: "old sandbox missing" }, { status: 404 });
    };
    const tool = createTerminalExec(
      "sandbox-old",
      "user-1",
      "00000000-0000-4000-8000-000000000001"
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await expect(tool.execute({ command: "pwd" })).resolves.toEqual({
      error: "INTERNAL_API_SECRET is required for delegated internal API calls",
      reason: "auth_unavailable",
      command: "pwd",
    });
  });

  it("reports a successful retry against the newly resolved sandbox", async () => {
    installSandboxRows([{ id: "sandbox-new" }]);
    global.fetch = async (input) =>
      String(input).endsWith("/sandbox-old/exec")
        ? Response.json({ error: "old sandbox missing" }, { status: 404 })
        : Response.json({ exitCode: 0, stdout: "ok", stderr: "" });
    const tool = createTerminalExec(
      "sandbox-old",
      "user-1",
      "00000000-0000-4000-8000-000000000001"
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await expect(tool.execute({ command: "pwd" })).resolves.toMatchObject({
      exitCode: 0,
      stdout: "ok",
      sandboxId: "sandbox-new",
      sandboxResolution: "reused_running",
    });
  });
});

describe("sandbox write tool contract", () => {
  it("requires and reports the server-selected sandbox identity", async () => {
    const unboundTool = createWriteFile("user-1") as unknown as {
      execute: (input: { path: string; content: string }) => Promise<unknown>;
    };
    await expect(
      unboundTool.execute({ path: "src/a.ts", content: "export {};" })
    ).resolves.toEqual({
      error: "Select a sandbox first.",
      reason: "sandbox_not_selected",
    });
    global.fetch = async () => Response.json({ ok: true });
    const boundTool = createWriteFile(
      "user-1",
      "sandbox-selected"
    ) as unknown as {
      execute: (input: { path: string; content: string }) => Promise<unknown>;
    };
    await expect(
      boundTool.execute({ path: "src/a.ts", content: "export {};" })
    ).resolves.toMatchObject({
      ok: true,
      path: "src/a.ts",
      sandboxId: "sandbox-selected",
    });
  });
});
