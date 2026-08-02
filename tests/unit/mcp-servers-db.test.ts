import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const shouldRunDbTests = process.env.MOGPLEX_RUN_DB_TESTS === "1";

test("user MCP servers enforce RLS for user reads and delete linked Vault secrets", async (t) => {
  if (!shouldRunDbTests) {
    t.skip("Set MOGPLEX_RUN_DB_TESTS=1 to run Supabase integration coverage");
    return;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  assert.ok(
    supabaseUrl,
    "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required"
  );
  assert.ok(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
  assert.ok(
    serviceRoleKey,
    "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required"
  );

  process.env.NEXT_PUBLIC_SUPABASE_URL ||= supabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= serviceRoleKey;

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const reader = createClient(supabaseUrl, anonKey);

  const { createUserMcpServer, deleteUserMcpServer } =
    await import("../../lib/mcp-servers");

  const suffix = crypto.randomUUID().slice(0, 8);
  const emailA = `mcp-a-${suffix}@example.com`;
  const emailB = `mcp-b-${suffix}@example.com`;
  const password = `Mogplex!${suffix}123`;
  const profileIdA = crypto.randomUUID();
  const profileIdB = crypto.randomUUID();

  let authUserIdA: string | null = null;
  let authUserIdB: string | null = null;
  let serverIdA: string | null = null;
  let serverIdB: string | null = null;

  try {
    const createdUserA = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    assert.ifError(createdUserA.error);
    authUserIdA = createdUserA.data.user?.id ?? null;
    assert.ok(authUserIdA, "expected auth user A");

    const createdUserB = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    assert.ifError(createdUserB.error);
    authUserIdB = createdUserB.data.user?.id ?? null;
    assert.ok(authUserIdB, "expected auth user B");

    const insertedProfiles = await admin.from("profiles").insert([
      {
        id: profileIdA,
        auth_user_id: authUserIdA,
        email: emailA,
        username: `mcp-a-${suffix}`,
        name: "MCP User A",
      },
      {
        id: profileIdB,
        auth_user_id: authUserIdB,
        email: emailB,
        username: `mcp-b-${suffix}`,
        name: "MCP User B",
      },
    ]);
    assert.ifError(insertedProfiles.error);

    const createdA = await createUserMcpServer(profileIdA, {
      name: `supabase-${suffix}`,
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@supabase/mcp-server-supabase@latest"],
      envPlain: {},
      envSecrets: {
        SUPABASE_ACCESS_TOKEN: `sbp_${suffix}`,
      },
      url: null,
      headerPlain: {},
      headerSecrets: {},
      extra: {},
    });
    serverIdA = createdA.id;

    const createdB = await createUserMcpServer(profileIdB, {
      name: `linear-${suffix}`,
      enabled: true,
      transport: "http",
      command: null,
      args: [],
      envPlain: {},
      envSecrets: {},
      url: "https://mcp.linear.app/sse",
      headerPlain: {},
      headerSecrets: {
        Authorization: `Bearer lin_${suffix}`,
      },
      extra: {},
    });
    serverIdB = createdB.id;

    const secretRefsResult = await admin
      .from("user_mcp_servers")
      .select("env_refs")
      .eq("id", serverIdA)
      .single();
    assert.ifError(secretRefsResult.error);

    const secretIdsA = Object.values(
      (secretRefsResult.data?.env_refs ?? {}) as Record<string, string>
    );
    assert.equal(secretIdsA.length, 1);

    const beforeDeleteCount = await admin.rpc("count_user_mcp_server_secrets", {
      p_user_id: profileIdA,
      p_secret_ids: secretIdsA,
    });
    assert.ifError(beforeDeleteCount.error);
    assert.equal(beforeDeleteCount.data, 1);

    const signInA = await reader.auth.signInWithPassword({
      email: emailA,
      password,
    });
    assert.ifError(signInA.error);

    const rlsResult = await reader
      .from("user_mcp_servers")
      .select("id, name, user_id")
      .order("name");
    assert.ifError(rlsResult.error);
    assert.equal(rlsResult.data?.length, 1);
    assert.equal(rlsResult.data?.[0].id, serverIdA);
    assert.equal(rlsResult.data?.[0].user_id, profileIdA);

    const deleted = await deleteUserMcpServer(profileIdA, serverIdA);
    assert.equal(deleted, true);
    serverIdA = null;

    const afterDeleteCount = await admin.rpc("count_user_mcp_server_secrets", {
      p_user_id: profileIdA,
      p_secret_ids: secretIdsA,
    });
    assert.ifError(afterDeleteCount.error);
    assert.equal(afterDeleteCount.data, 0);
  } finally {
    if (serverIdA) {
      await admin.from("user_mcp_servers").delete().eq("id", serverIdA);
    }
    if (serverIdB) {
      await admin.from("user_mcp_servers").delete().eq("id", serverIdB);
    }
    await admin.from("profiles").delete().in("id", [profileIdA, profileIdB]);
    if (authUserIdA) {
      await admin.auth.admin.deleteUser(authUserIdA);
    }
    if (authUserIdB) {
      await admin.auth.admin.deleteUser(authUserIdB);
    }
  }
});
