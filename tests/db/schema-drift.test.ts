import { afterAll, beforeAll, expect, it } from "vitest";
import { createPostgrestTestDb } from "./helpers/postgrest-shim-fixtures";
import { SCHEMA_DRIFT_MESSAGE } from "@/lib/schema-drift";
import * as Sentry from "@sentry/nextjs";

let fixture: Awaited<ReturnType<typeof createPostgrestTestDb>>;
const events: Sentry.Event[] = [];
beforeAll(async () => {
  Sentry.init({
    dsn: "https://public@sentry.test/1",
    defaultIntegrations: false,
    skipOpenTelemetrySetup: true,
    transport: () => ({
      send: async (
        envelope: Parameters<
          NonNullable<
            ReturnType<
              NonNullable<ReturnType<typeof Sentry.getClient>>["getTransport"]
            >
          >["send"]
        >[0]
      ) => {
        for (const [header, payload] of envelope[1]) {
          if (header.type === "event") events.push(payload as Sentry.Event);
        }
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  fixture = await createPostgrestTestDb();
});
afterAll(async () => {
  await fixture.pglite.close();
  await Sentry.close();
});

it("reports auth and storage schema failures without account or object data", async () => {
  const { pglite, db } = fixture;
  await pglite.exec('alter table "user" rename column email to removed_email');
  const auth = await db.auth.admin.getUserById(
    "00000000-0000-4000-8000-000000000001"
  );
  expect(auth.error?.message).toBe(SCHEMA_DRIFT_MESSAGE);
  expect(events.at(-1)).toMatchObject({
    tags: {
      operation: "auth.getUserById",
      db_target: "user",
      schema_code: "42703",
    },
  });
  expect(JSON.stringify(events.at(-1))).not.toContain(
    "00000000-0000-4000-8000-000000000001"
  );
  await pglite.exec('alter table "user" rename column removed_email to email');

  await pglite.exec(
    "alter table storage_objects rename to removed_storage_objects"
  );
  const bucket = db.storage.from("private-bucket");
  for (const [operation, result] of [
    ["storage.remove", await bucket.remove(["private-object"])],
    [
      "storage.upload",
      await bucket.upload("private-object", new Uint8Array([1, 2])),
    ],
    ["storage.list", await bucket.list("private-prefix")],
  ] as const) {
    expect(result.error?.message).toBe(SCHEMA_DRIFT_MESSAGE);
    expect(events).toContainEqual(
      expect.objectContaining({
        tags: expect.objectContaining({
          operation,
          db_target: "storage_objects",
          schema_code: "42P01",
        }),
      })
    );
  }
  expect(JSON.stringify(events)).not.toContain("private-object");
  expect(JSON.stringify(events)).not.toContain("private-bucket");
  await pglite.exec(
    "alter table removed_storage_objects rename to storage_objects"
  );
});

it("fails a write safely when a column is missing, then refreshes metadata after schema repair", async () => {
  const { pglite, db } = fixture;
  await pglite.exec("create table drift_items (id int primary key, name text)");
  await db.from("drift_items").insert({ id: 1, name: "existing work" });
  const failed = await db
    .from("drift_items")
    .insert({ id: 2, payload: { draft: "keep" } });
  expect(events.at(-1)).toMatchObject({
    tags: {
      operation: "insert",
      db_target: "drift_items",
      schema_code: "42703",
    },
  });
  expect(JSON.stringify(events.at(-1))).not.toContain("keep");
  expect(failed).toMatchObject({
    data: null,
    status: 503,
    error: {
      code: "42703",
      message: SCHEMA_DRIFT_MESSAGE,
      details: null,
      hint: null,
    },
  });
  expect((await pglite.query("select * from drift_items")).rows).toEqual([
    { id: 1, name: "existing work" },
  ]);
  await pglite.exec("alter table drift_items add column payload jsonb");
  const retried = await db
    .from("drift_items")
    .insert({ id: 2, payload: { draft: "keep" } })
    .select("id, payload")
    .single();
  expect(retried.error).toBeNull();
  expect(retried.data).toEqual({ id: 2, payload: { draft: "keep" } });
  expect(
    (await pglite.query("select count(*)::int as count from drift_items")).rows
  ).toEqual([{ count: 2 }]);
});

it("clears cached RPC signatures after drift so a later request can use a repaired function", async () => {
  const { pglite, db } = fixture;
  await pglite.exec(
    "create function drift_echo(p_value text) returns text language sql as $$ select p_value $$"
  );
  expect((await db.rpc("drift_echo", { p_value: "before" })).data).toBe(
    "before"
  );
  await pglite.exec("drop function drift_echo(text)");
  const failed = await db.rpc("drift_echo", { p_value: "draft" });
  expect(events.at(-1)).toMatchObject({
    tags: { operation: "rpc", db_target: "drift_echo", schema_code: "42883" },
  });
  expect(failed).toMatchObject({
    data: null,
    status: 503,
    error: { code: "42883", message: SCHEMA_DRIFT_MESSAGE },
  });
  await pglite.exec(
    `create function drift_echo(p_value jsonb) returns setof jsonb language sql
     as $$ select p_value union all select p_value || '{"recovered":true}'::jsonb $$`
  );
  const retried = await db.rpc("drift_echo", { p_value: { draft: "keep" } });
  expect(retried.error).toBeNull();
  expect(retried.data).toEqual([
    { draft: "keep" },
    { draft: "keep", recovered: true },
  ]);
});

it("preserves missing-table codes for optional-schema callers while withholding database details", async () => {
  const { db } = fixture;
  const missing = await db.from("private_missing_table").insert({ id: 1 });
  expect(missing).toMatchObject({
    data: null,
    status: 503,
    error: {
      code: "42P01",
      message: SCHEMA_DRIFT_MESSAGE,
      details: null,
      hint: null,
    },
  });
  expect(JSON.stringify(missing)).not.toContain("private_missing_table");
  const missingFunction = await db.rpc("private_missing_function");
  expect(missingFunction.error).toMatchObject({
    code: "PGRST202",
    message: SCHEMA_DRIFT_MESSAGE,
  });
});
