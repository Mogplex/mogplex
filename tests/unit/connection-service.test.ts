import assert from "node:assert/strict";
import test from "node:test";
import { decrypt } from "../../lib/connections/encryption";

function setConnectionServiceEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.CONNECTIONS_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}

async function loadConnectionService() {
  setConnectionServiceEnv();
  return import("../../lib/connections/service");
}

test("createConnection encrypts credentials before inserting", async () => {
  setConnectionServiceEnv();
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  let inserted: Record<string, unknown> | null = null;

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value(table: string) {
      assert.equal(table, "connections");
      return {
        insert(payload: Record<string, unknown>) {
          inserted = payload;
          return this;
        },
        select() {
          return this;
        },
        single: async () => ({
          data: {
            id: "conn-1",
            user_id: "user-1",
          },
          error: null,
        }),
      };
    },
  });

  try {
    const { createConnection } = await loadConnectionService();
    await createConnection("user-1", {
      name: "Sentry",
      type: "mcp_server",
      auth_type: "oauth",
      auth_header: "Authorization",
      mcp_transport: "http",
      mcp_url: "https://mcp.sentry.dev/mcp",
      credentials: '{"kind":"pipedream_connect","account_id":"apn_sentry_123"}',
      source_preset: "sentry",
    });

    assert.ok(inserted);
    const insertedRow = inserted as Record<string, unknown>;
    assert.equal(insertedRow.user_id, "user-1");
    assert.notEqual(
      insertedRow.encrypted_credentials,
      '{"kind":"pipedream_connect","account_id":"apn_sentry_123"}'
    );
    assert.equal(
      decrypt(insertedRow.encrypted_credentials as string),
      '{"kind":"pipedream_connect","account_id":"apn_sentry_123"}'
    );
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: originalFrom,
    });
  }
});

test("updateConnection encrypts credentials before updating", async () => {
  setConnectionServiceEnv();
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  let updated: Record<string, unknown> | null = null;
  let updatedId: string | null = null;

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value(table: string) {
      assert.equal(table, "connections");
      return {
        update(payload: Record<string, unknown>) {
          updated = payload;
          return this;
        },
        eq(column: string, value: string) {
          assert.equal(column, "id");
          updatedId = value;
          return Promise.resolve({ error: null });
        },
      };
    },
  });

  try {
    const { updateConnection } = await loadConnectionService();
    await updateConnection("conn-1", {
      credentials: '{"kind":"pipedream_connect","account_id":"apn_sentry_456"}',
    });

    assert.equal(updatedId, "conn-1");
    assert.ok(updated);
    const updatedRow = updated as Record<string, unknown>;
    assert.notEqual(
      updatedRow.encrypted_credentials,
      '{"kind":"pipedream_connect","account_id":"apn_sentry_456"}'
    );
    assert.equal(
      decrypt(updatedRow.encrypted_credentials as string),
      '{"kind":"pipedream_connect","account_id":"apn_sentry_456"}'
    );
    assert.equal(typeof updatedRow.updated_at, "string");
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: originalFrom,
    });
  }
});

test("upsertConnectionBySourcePreset encrypts credentials before rpc upsert", async () => {
  setConnectionServiceEnv();
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const originalRpc = supabaseAdmin.rpc.bind(supabaseAdmin);
  let rpcName: string | null = null;
  let rpcArgs: Record<string, unknown> | null = null;

  Object.defineProperty(supabaseAdmin, "rpc", {
    configurable: true,
    value(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return Promise.resolve({
        data: "conn-upserted",
        error: null,
      });
    },
  });

  try {
    const { upsertConnectionBySourcePreset } = await loadConnectionService();
    const connectionId = await upsertConnectionBySourcePreset("user-1", {
      source_preset: "sentry",
      name: "Sentry",
      type: "mcp_server",
      auth_type: "oauth",
      auth_header: "Authorization",
      mcp_transport: "http",
      mcp_url: "https://mcp.sentry.dev/mcp",
      credentials: '{"kind":"pipedream_connect","account_id":"apn_sentry_789"}',
      description: "Error tracking",
      oauth_scopes: "event:read",
    });

    assert.equal(connectionId, "conn-upserted");
    assert.equal(rpcName, "upsert_connection_by_source_preset");
    assert.ok(rpcArgs);
    const upsertArgs = rpcArgs as Record<string, unknown>;
    assert.equal(upsertArgs.p_user_id, "user-1");
    assert.equal(upsertArgs.p_source_preset, "sentry");
    assert.notEqual(
      upsertArgs.p_encrypted_credentials,
      '{"kind":"pipedream_connect","account_id":"apn_sentry_789"}'
    );
    assert.equal(
      decrypt(upsertArgs.p_encrypted_credentials as string),
      '{"kind":"pipedream_connect","account_id":"apn_sentry_789"}'
    );
  } finally {
    Object.defineProperty(supabaseAdmin, "rpc", {
      configurable: true,
      value: originalRpc,
    });
  }
});
