import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createStartSandbox, createTerminalExec } from "./sandbox";
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
  repoLookup: { id: string } | null = null
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
    maybeSingle: async () => ({ data: repoLookup, error: null }),
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
    ).resolves.toBeNull();
  });
});

describe("sandbox command tool contract", () => {
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
});
