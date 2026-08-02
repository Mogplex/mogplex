import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260723130000_flow_node_runs_action.sql",
  import.meta.url
);

test("flow action migration permits action node run persistence", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /drop constraint if exists flow_node_runs_node_type_check/i
  );
  assert.match(sql, /add constraint flow_node_runs_node_type_check/i);
  assert.match(sql, /node_type in \([\s\S]*'action'/i);
});
