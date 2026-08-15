import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

async function loadAdminModule() {
  return import("../../lib/supabase/admin");
}

test("admin connection runner keeps the default client for Supabase", async () => {
  const { createSupabaseAdminConnectionRunner } = await loadAdminModule();
  const defaultClient = { source: "supabase" } as unknown as SupabaseClient;
  let connected = false;
  const run = createSupabaseAdminConnectionRunner({
    getDataBackend: () => "supabase",
    defaultClient,
    getPool: (() => {
      connected = true;
      throw new Error("Neon pool should not be loaded");
    }) as never,
  });

  const result = await run(async (client) => client);

  assert.equal(result, defaultClient);
  assert.equal(connected, false);
});

test("admin connection runner reuses one Neon connection and releases it", async () => {
  const { createSupabaseAdminConnectionRunner } = await loadAdminModule();
  const connection = { releaseCalls: 0 };
  const neonClient = { source: "neon" } as unknown as SupabaseClient;
  let connectCalls = 0;
  const run = createSupabaseAdminConnectionRunner({
    getDataBackend: () => "neon",
    getPool: (() => ({
      connect: async () => {
        connectCalls += 1;
        return {
          release: () => {
            connection.releaseCalls += 1;
          },
        };
      },
    })) as never,
    createShim: (() => neonClient) as never,
  });

  const clients = await run(async (client) => [client, client]);

  assert.deepEqual(clients, [neonClient, neonClient]);
  assert.equal(connectCalls, 1);
  assert.equal(connection.releaseCalls, 1);
});

test("admin connection runner releases Neon connections after failures", async () => {
  const { createSupabaseAdminConnectionRunner } = await loadAdminModule();
  let releaseCalls = 0;
  const run = createSupabaseAdminConnectionRunner({
    getDataBackend: () => "neon",
    getPool: (() => ({
      connect: async () => ({
        release: () => {
          releaseCalls += 1;
        },
      }),
    })) as never,
    createShim: (() => ({ source: "neon" })) as never,
  });

  await assert.rejects(
    run(async () => {
      throw new Error("loader failed");
    }),
    /loader failed/
  );
  assert.equal(releaseCalls, 1);
});
