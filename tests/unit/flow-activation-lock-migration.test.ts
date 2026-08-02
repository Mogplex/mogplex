import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260723200000_flow_activation_lock.sql",
    import.meta.url
  ),
  "utf8"
);

test("workflow activation locks are internal, owner-linked rows", () => {
  assert.match(
    sql,
    /create table if not exists public\.flow_activation_locks/i
  );
  assert.match(
    sql,
    /flow_id uuid primary key references public\.flows\(id\) on delete cascade/i
  );
  assert.match(
    sql,
    /alter table public\.flow_activation_locks enable row level security/i
  );
  assert.match(
    sql,
    /revoke all on table public\.flow_activation_locks\s+from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant select, insert, update, delete on table public\.flow_activation_locks\s+to service_role/i
  );
});
