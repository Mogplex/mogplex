import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  createStartSandbox,
  createTerminalExec,
  createWriteFile,
} from "./sandbox";
import { resolveOrCreateSandbox } from "./sandbox-resolution";

type RunningSandbox = { id: string };

let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
let originalFrom: typeof supabaseAdmin.from;
const originalFetch = global.fetch;
const originalSecret = process.env.INTERNAL_API_SECRET;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function installSandboxRows(
  running: RunningSandbox[],
  repoLookup: { id: string } | null = null,
  repoLookupError: { message: string } | null = null
) {
  const sandboxQuery = {
    select: () => sandboxQuery,
    eq: () => sandboxQuery,
    order: () => sandboxQuery,
    limit: async () => ({ data: running, error: null }),
  };
  const repoQuery = {
    select: () => repoQuery,
    eq: () => repoQuery,
    maybeSingle: async () => ({ data: repoLookup, error: repoLookupError }),
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: (table: string) =>
      table === "sandboxes" ? sandboxQuery : repoQuery,
  });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
});

afterAll(() => {
  if (originalSupabaseUrl === undefined)
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  if (originalServiceRoleKey === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
});

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = "internal-secret";
  installSandboxRows([]);
});

afterEach(() => {
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: originalFrom,
  });
  Object.defineProperty(global, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = originalSecret;
});

describe("sandbox resolution contract", () => {
  it("uses an explicit selected sandbox without account lookup", async () => {
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
        "Multiple running sandboxes are available for this repository. Select one explicitly before continuing.",
      reason: "multiple_sandboxes",
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

  it("resolves an owned full name and consumes sandbox creation SSE", async () => {
    installSandboxRows([], {
      id: "00000000-0000-4000-8000-000000000001",
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"sandbox_created","recordId":"sandbox-sse"}\n\n'
          )
        );
      },
    });
    global.fetch = async () =>
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });

    expect(await resolveOrCreateSandbox("user-1", "acme/demo")).toEqual({
      sandboxId: "sandbox-sse",
      status: "pending",
      source: "created",
    });
  });

  it("rejects missing or unowned repository context", async () => {
    await expect(resolveOrCreateSandbox()).resolves.toBeNull();
    await expect(resolveOrCreateSandbox("user-1")).resolves.toBeNull();
    await expect(
      resolveOrCreateSandbox("user-1", "acme/missing")
    ).resolves.toEqual({
      error: "Failed to start sandbox",
      reason: "repo_mismatch",
    });
  });

  it("distinguishes repository lookup failures from ownership mismatches", async () => {
    installSandboxRows([], null, { message: "database unavailable" });
    await expect(
      resolveOrCreateSandbox("user-1", "acme/unavailable")
    ).resolves.toEqual({
      error: "Failed to start sandbox",
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
      error: expect.stringContaining("Select one explicitly"),
    });
    expect(fetched).toBe(false);
  });

  it("disables fallback when server-owned context requires selection", async () => {
    installSandboxRows([{ id: "sandbox-1" }]);
    let fetched = false;
    global.fetch = async () => {
      fetched = true;
      return Response.json({ exitCode: 0 });
    };
    const tool = createTerminalExec(
      undefined,
      "user-1",
      "00000000-0000-4000-8000-000000000001",
      false
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await expect(tool.execute({ command: "pwd" })).resolves.toMatchObject({
      reason: "multiple_sandboxes",
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
    ).resolves.toEqual({
      ok: true,
      path: "src/a.ts",
      sandboxId: "sandbox-selected",
    });
  });
});
