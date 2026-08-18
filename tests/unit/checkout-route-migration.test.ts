import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../neon/migrations/20260818150000_reserve_checkout_slug.sql",
  import.meta.url
);

test("checkout slug reservation is enforced and existing collisions are moved", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create or replace function public\.is_reserved_slug/i);
  assert.match(sql, /'checkout'/i);
  assert.match(sql, /from public\.profiles\s+where slug = 'checkout'/i);
  assert.match(sql, /from public\.teams\s+where slug = 'checkout'/i);
  assert.match(sql, /not public\.is_reserved_slug\(v_candidate\)/i);
});
