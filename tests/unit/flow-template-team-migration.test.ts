import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260724210000_team_flow_templates.sql",
  import.meta.url
);

test("team flow template ownership is added in a forward migration", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /add column if not exists owner_type\s+text/i);
  assert.match(sql, /add column if not exists owner_user_id\s+uuid/i);
  assert.match(sql, /add column if not exists product_team_id\s+uuid/i);
  assert.match(sql, /add column if not exists created_by_user_id\s+uuid/i);
  assert.match(sql, /update public\.flow_templates/i);
  assert.match(sql, /flow_templates_owner_shape_check/i);
  assert.match(sql, /set_flow_template_ownership_defaults/i);
  assert.match(sql, /before insert on public\.flow_templates/i);
  assert.match(sql, /new\.owner_user_id := new\.user_id/i);
  assert.match(sql, /public\.is_team_member\(product_team_id\)/i);
  assert.match(sql, /public\.user_team_role\(product_team_id\)/i);
  assert.match(
    sql,
    /create index if not exists flow_templates_team_updated_idx/i
  );

  const backfillIndex = sql.indexOf("update public.flow_templates");
  const notNullIndex = sql.indexOf("alter column owner_user_id");
  assert.ok(backfillIndex !== -1);
  assert.ok(notNullIndex === -1 || backfillIndex < notNullIndex);
});
