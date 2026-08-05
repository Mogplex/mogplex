import assert from "node:assert/strict";
import test from "node:test";

test("sandbox updates reload embedded relations after a narrow write", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const { updateSandboxRecord } = await import("../../lib/sandbox/records");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  const selects: string[] = [];

  const buildQuery = (result: unknown) => {
    const query = {
      update: () => query,
      eq: () => query,
      in: () => query,
      select: (value: string) => {
        selects.push(value);
        return query;
      },
      maybeSingle: async () => ({ data: result, error: null }),
    };
    return query;
  };

  let call = 0;
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: () =>
      buildQuery(
        call++ === 0
          ? { id: "sandbox-1", sandbox_id: "vm-1", status: "running" }
          : {
              id: "sandbox-1",
              repo: { root_directory: "apps/web" },
            }
      ),
  });

  try {
    const result = await updateSandboxRecord(
      "sandbox-1",
      { health_status: "running" },
      { select: "id, repo:repos(root_directory)" }
    );

    assert.deepEqual(selects, [
      "id, sandbox_id, status, health_status",
      "id, repo:repos(root_directory)",
    ]);
    assert.deepEqual(result, {
      id: "sandbox-1",
      repo: { root_directory: "apps/web" },
    });
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
  }
});
