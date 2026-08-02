import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260723190000_flow_trigger_expansion.sql",
  import.meta.url
);

test("flow trigger migration widens sources and stores webhook secrets in Vault", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /trigger_schedule_id text/i);
  assert.match(sql, /vault_webhook_secret_id uuid/i);
  assert.match(
    sql,
    /source_kind in \('github', 'schedule', 'webhook', 'slack'\)/i
  );
  assert.match(sql, /vault\.create_secret/i);
  assert.match(sql, /vault\.decrypted_secrets/i);
  assert.match(sql, /delete_flow_webhook_secret_on_flow_delete/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /from public, anon, authenticated/i);
  assert.match(
    sql,
    /grant execute on function public\.get_flow_webhook_secret\(uuid\)\s+to service_role/i
  );
});
