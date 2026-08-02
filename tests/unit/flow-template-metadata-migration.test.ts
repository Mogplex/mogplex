import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const createMigrationUrl = new URL(
  "../../supabase/migrations/20260724140000_personal_flow_templates.sql",
  import.meta.url
);
const metadataMigrationUrl = new URL(
  "../../supabase/migrations/20260724190000_flow_template_metadata.sql",
  import.meta.url
);

test("flow template metadata is backfilled by a forward migration", async () => {
  const [createSql, metadataSql] = await Promise.all([
    readFile(createMigrationUrl, "utf8"),
    readFile(metadataMigrationUrl, "utf8"),
  ]);

  assert.doesNotMatch(
    createSql,
    /trigger_event|requires_repository|reconnect/i
  );
  assert.match(metadataSql, /add column if not exists trigger_event\s+text/i);
  assert.match(metadataSql, /add column if not exists reconnect\s+text\[\]/i);
  assert.match(
    metadataSql,
    /add column if not exists requires_repository\s+boolean/i
  );
  assert.match(metadataSql, /jsonb_array_elements/i);
  assert.match(metadataSql, /slack\.send_message/i);
  assert.match(metadataSql, /alter column trigger_event set not null/i);
  assert.match(metadataSql, /alter column reconnect set not null/i);
  assert.match(metadataSql, /alter column requires_repository set not null/i);

  const backfillIndex = metadataSql.indexOf("update public.flow_templates");
  assert.ok(backfillIndex !== -1);
  assert.ok(
    backfillIndex <
      metadataSql.indexOf("alter column trigger_event set not null")
  );
});
