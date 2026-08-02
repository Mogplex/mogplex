import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260727190000_provider_icons.sql",
  import.meta.url
);

test("provider icon storage is public-read and service-role-write only", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /'provider-icons',\s*'provider-icons',\s*true/i);
  assert.match(sql, /512\s*\*\s*1024/i);
  assert.match(sql, /array\['image\/png'\]/i);
  assert.doesNotMatch(sql, /create\s+policy/i);
  assert.match(sql, /drop policy if exists provider_icons_insert/i);
  assert.match(sql, /drop policy if exists provider_icons_update/i);
  assert.match(sql, /drop policy if exists provider_icons_delete/i);
});
