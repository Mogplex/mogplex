import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { resolveOrCreateSandbox } from "./sandbox-resolution";

let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
let originalFrom: typeof supabaseAdmin.from;
const originalFetch = global.fetch;
const originalSecret = process.env.INTERNAL_API_SECRET;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: async () => ({ data: [], error: null }),
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: () => query,
  });
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

describe("sandbox resolution lifecycle", () => {
  it("does not report a stopped reused sandbox as pending", async () => {
    global.fetch = async () =>
      Response.json({
        sandbox: {
          id: "sandbox-stopped",
          runtime_summary: { status: "stopped" },
        },
      });

    await expect(
      resolveOrCreateSandbox("user-1", "00000000-0000-4000-8000-000000000001")
    ).resolves.toEqual({
      error: "Sandbox stopped before it became ready.",
      reason: "sandbox_unavailable",
    });
  });

  it("waits for sandbox readiness over SSE", async () => {
    let acceptHeader: string | undefined;
    global.fetch = async (_url, init) => {
      acceptHeader = (init?.headers as Record<string, string>)?.Accept;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                [
                  'data: {"type":"sandbox_created","recordId":"sandbox-sse"}',
                  'data: {"type":"ready","sandbox":{"id":"sandbox-sse"}}',
                  "",
                ].join("\n\n")
              )
            );
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } }
      );
    };

    await expect(
      resolveOrCreateSandbox("user-1", "00000000-0000-4000-8000-000000000001")
    ).resolves.toEqual({
      sandboxId: "sandbox-sse",
      status: "running",
      source: "created",
    });
    expect(acceptHeader).toBe("text/event-stream, application/json");
  });

  it("returns the streamed launch failure after sandbox creation", async () => {
    global.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                [
                  'data: {"type":"sandbox_created","recordId":"sandbox-sse"}',
                  'data: {"type":"error","message":"Provider stopped the sandbox"}',
                  "",
                ].join("\n\n")
              )
            );
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } }
      );

    await expect(
      resolveOrCreateSandbox("user-1", "00000000-0000-4000-8000-000000000001")
    ).resolves.toEqual({
      error: "Provider stopped the sandbox",
      reason: "sandbox_unavailable",
    });
  });
});
