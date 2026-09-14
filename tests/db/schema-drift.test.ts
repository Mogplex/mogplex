import { afterAll, beforeAll, expect, it } from "vitest";
import { createPostgrestTestDb } from "./helpers/postgrest-shim-fixtures";
import { SCHEMA_DRIFT_MESSAGE } from "@/lib/schema-drift";

let fixture: Awaited<ReturnType<typeof createPostgrestTestDb>>;
beforeAll(async () => {
  fixture = await createPostgrestTestDb();
});
afterAll(async () => {
  await fixture.pglite.close();
});

it("fails a write safely when a column is missing, then refreshes metadata after schema repair", async () => {
  const { pglite, db } = fixture;
  await pglite.exec("create table drift_items (id int primary key, name text)");
  await db.from("drift_items").insert({ id: 1, name: "existing work" });
  const failed = await db
    .from("drift_items")
    .insert({ id: 2, payload: { draft: "keep" } });
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
