import assert from "node:assert/strict";
import test from "node:test";

function setSlackInstallationsEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

async function loadSlackInstallations() {
  setSlackInstallationsEnv();
  return import("../../lib/slack/installations");
}

test("escapePostgrestLikePattern escapes wildcard metacharacters", async () => {
  const { escapePostgrestLikePattern } = await loadSlackInstallations();

  assert.equal(
    escapePostgrestLikePattern(String.raw`a_%\b@example.com`),
    String.raw`a\_\%\\b@example.com`
  );
});

test("isSlackThreadConversationUniqueConflict detects binding races", async () => {
  const { isSlackThreadConversationUniqueConflict } =
    await loadSlackInstallations();

  assert.equal(
    isSlackThreadConversationUniqueConflict({
      code: "23505",
      message:
        "duplicate key value violates unique constraint slack_thread_conversations_unique",
    }),
    true
  );
  assert.equal(
    isSlackThreadConversationUniqueConflict({
      message:
        "duplicate key value violates unique constraint slack_thread_conversations_unique",
    }),
    true
  );
  assert.equal(
    isSlackThreadConversationUniqueConflict({
      code: "23503",
      message: "foreign key violation",
    }),
    false
  );
});

test("isPostgresUniqueViolation detects Postgres code through wrapped errors", async () => {
  const { isPostgresUniqueViolation } = await loadSlackInstallations();

  const cause = { code: "23505" };
  const wrapped = new Error("localized duplicate message", { cause });

  assert.equal(isPostgresUniqueViolation(wrapped), true);
  assert.equal(isPostgresUniqueViolation({ code: "23503" }), false);
});

test("isExplicitSlackUserMapping only accepts explicitly linked profiles", async () => {
  const { isExplicitSlackUserMapping } = await loadSlackInstallations();

  assert.equal(
    isExplicitSlackUserMapping({
      id: "map-1",
      slack_installation_id: "install-1",
      slack_user_id: "U1",
      mogplex_user_id: "user-1",
      slack_email: "u@example.com",
      matched_at: "2026-05-15T00:00:00Z",
      link_status: "explicit",
      linked_at: "2026-05-15T00:00:00Z",
      linked_by_user_id: "user-1",
      created_at: "2026-05-15T00:00:00Z",
    }),
    true
  );
  assert.equal(
    isExplicitSlackUserMapping({
      id: "map-2",
      slack_installation_id: "install-1",
      slack_user_id: "U1",
      mogplex_user_id: "user-1",
      slack_email: "u@example.com",
      matched_at: "2026-05-15T00:00:00Z",
      link_status: "legacy_email",
      created_at: "2026-05-15T00:00:00Z",
    }),
    false
  );
});

test("consumeSlackUserLinkToken rejects empty token contract violations", async () => {
  const { consumeSlackUserLinkToken } = await loadSlackInstallations();

  await assert.rejects(
    consumeSlackUserLinkToken({ token: "", mogplexUserId: "user-1" }),
    /consumeSlackUserLinkToken called with empty token/
  );
});

test("upsertSlackUserMapping does not downgrade an explicit mapping after a race", async (t) => {
  const { upsertSlackUserMapping } = await loadSlackInstallations();
  const operations: Array<{
    op: string;
    field?: string;
    value?: unknown;
    payload?: unknown;
  }> = [];
  const explicitRow = {
    id: "map-1",
    slack_installation_id: "install-1",
    slack_user_id: "U1",
    mogplex_user_id: "user-1",
    slack_email: "u@example.com",
    matched_at: "2026-05-15T00:00:00Z",
    link_status: "explicit" as const,
    linked_at: "2026-05-15T00:00:00Z",
    linked_by_user_id: "user-1",
    created_at: "2026-05-15T00:00:00Z",
  };

  const client = {
    from: () => ({
      insert(payload: unknown) {
        operations.push({ op: "insert", payload });
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: "23505", message: "duplicate key" },
            }),
          }),
        };
      },
      update(payload: unknown) {
        operations.push({ op: "update", payload });
        const chain = {
          eq(field: string, value: unknown) {
            operations.push({ op: "update.eq", field, value });
            return chain;
          },
          neq(field: string, value: unknown) {
            operations.push({ op: "update.neq", field, value });
            return chain;
          },
          select: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        };
        return chain;
      },
      select() {
        const chain = {
          eq(field: string, value: unknown) {
            operations.push({ op: "select.eq", field, value });
            return chain;
          },
          maybeSingle: async () => ({ data: explicitRow, error: null }),
        };
        return chain;
      },
    }),
  } as unknown as Parameters<typeof upsertSlackUserMapping>[1];

  const infoCalls: unknown[][] = [];
  t.mock.method(console, "info", (...args: unknown[]) => {
    infoCalls.push(args);
  });
  const result = await upsertSlackUserMapping(
    {
      installationId: "install-1",
      slackUserId: "U1",
      mogplexUserId: "legacy-user",
      slackEmail: "u@example.com",
    },
    client
  );

  assert.equal(result.link_status, "explicit");
  assert.equal(result.mogplex_user_id, "user-1");
  assert.equal(infoCalls.length, 1);
  assert.ok(
    operations.some(
      (operation) =>
        operation.op === "update.neq" &&
        operation.field === "link_status" &&
        operation.value === "explicit"
    )
  );
});

test("upsertSlackUserMapping debug logs non-explicit mapping races", async (t) => {
  const { upsertSlackUserMapping } = await loadSlackInstallations();
  const legacyRow = {
    id: "map-1",
    slack_installation_id: "install-1",
    slack_user_id: "U1",
    mogplex_user_id: "legacy-user",
    slack_email: "u@example.com",
    matched_at: "2026-05-15T00:00:00Z",
    link_status: "legacy_email" as const,
    created_at: "2026-05-15T00:00:00Z",
  };

  const client = {
    from: () => ({
      insert() {
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: "23505", message: "duplicate key" },
            }),
          }),
        };
      },
      update() {
        const chain = {
          eq() {
            return chain;
          },
          neq() {
            return chain;
          },
          select: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        };
        return chain;
      },
      select() {
        const chain = {
          eq() {
            return chain;
          },
          maybeSingle: async () => ({ data: legacyRow, error: null }),
        };
        return chain;
      },
    }),
  } as unknown as Parameters<typeof upsertSlackUserMapping>[1];

  const infoCalls: unknown[][] = [];
  const debugCalls: unknown[][] = [];
  t.mock.method(console, "info", (...args: unknown[]) => {
    infoCalls.push(args);
  });
  t.mock.method(console, "debug", (...args: unknown[]) => {
    debugCalls.push(args);
  });

  const result = await upsertSlackUserMapping(
    {
      installationId: "install-1",
      slackUserId: "U1",
      mogplexUserId: "legacy-user",
      slackEmail: "u@example.com",
    },
    client
  );

  assert.equal(result.link_status, "legacy_email");
  assert.equal(infoCalls.length, 0);
  assert.equal(debugCalls.length, 1);
  assert.deepEqual(debugCalls[0]?.[1], {
    installationId: "install-1",
    slackUserId: "U1",
    linkStatus: "legacy_email",
  });
});

test("createSlackUserLinkToken revokes active links before issuing a fresh one", async () => {
  const { createSlackUserLinkToken } = await loadSlackInstallations();
  const operations: Array<{
    op: string;
    table?: string;
    field?: string;
    value?: unknown;
    payload?: Record<string, unknown>;
  }> = [];

  const client = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          operations.push({ op: "update", table, payload });
          const chain = {
            eq(field: string, value: unknown) {
              operations.push({ op: "update.eq", field, value });
              return chain;
            },
            is(field: string, value: unknown) {
              operations.push({ op: "update.is", field, value });
              return chain;
            },
            gt(field: string, value: unknown) {
              operations.push({ op: "update.gt", field, value });
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
        insert(payload: Record<string, unknown>) {
          operations.push({ op: "insert", table, payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as Parameters<typeof createSlackUserLinkToken>[1];

  const result = await createSlackUserLinkToken(
    {
      installationId: "install-1",
      teamId: "T1",
      slackUserId: "U1",
      ttlMs: 60_000,
    },
    client
  );

  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(result.expiresAt) > Date.now());
  const updateOperation = operations[0];
  assert.ok(updateOperation);
  assert.equal(updateOperation.op, "update");
  assert.equal(updateOperation.table, "slack_user_link_tokens");
  assert.ok(updateOperation.payload?.consumed_at);
  const updateGtOperation = operations.find(
    (operation) => operation.op === "update.gt"
  );
  assert.ok(updateGtOperation);
  assert.deepEqual(
    operations
      .filter((operation) => operation.op.startsWith("update."))
      .map(({ op, field, value }) => ({ op, field, value })),
    [
      { op: "update.eq", field: "slack_installation_id", value: "install-1" },
      { op: "update.eq", field: "slack_user_id", value: "U1" },
      { op: "update.is", field: "consumed_at", value: null },
      {
        op: "update.gt",
        field: "expires_at",
        value: updateGtOperation.value,
      },
    ]
  );
  const insertOperation = operations[operations.length - 1];
  assert.ok(insertOperation);
  assert.equal(insertOperation.op, "insert");
  assert.deepEqual(insertOperation.payload, {
    slack_installation_id: "install-1",
    team_id: "T1",
    slack_user_id: "U1",
    token_hash: insertOperation.payload?.token_hash,
    expires_at: result.expiresAt,
  });
  assert.match(String(insertOperation.payload?.token_hash), /^[a-f0-9]{64}$/);
});
