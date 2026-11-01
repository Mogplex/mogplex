import assert from "node:assert/strict";
import type { Queryable } from "@/lib/db/postgrest-shim";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import type { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadConnectionRecoveryRequest,
  markConnectionRecoveryDispatched,
  saveConnectionRecoveryRequest,
} from "@/lib/slack/connection-recovery/store";

const beforeUser = "00000000-0000-4000-8000-000000000001";
export async function seedSlackConnectionCompatibility(
  db: Queryable,
  userId: string,
  phase: string
) {
  await db.query(
    "insert into slack_installations(id, team_id, installed_by_user_id, bot_user_id, vault_bot_token_id) values($1,$2,$1,'B-compat',$1)",
    [userId, `T-connection-${phase}`]
  );
  const client = createPostgrestShim(db) as unknown as Pick<
    typeof supabaseAdmin,
    "from"
  >;
  await saveConnectionRecoveryRequest(
    {
      user_id: userId,
      slack_installation_id: userId,
      target: { provider: "github", access: "read" },
      payload: {
        teamId: `T-connection-${phase}`,
        channelId: "D-compat",
        threadTs: "1.1",
        messageTs: "1.1",
        slackUserId: "U-compat",
        eventId: `Ev-connection-${phase}`,
        text: "List repositories",
        channelType: "im",
        eventType: "message",
      },
      resume_text: "List repositories",
      product_team_id: null,
      repo_id: null,
    },
    client
  );
}
export async function verifySlackConnectionCompatibility(db: Queryable) {
  const rows = await db.query(
    "select id from slack_connection_requests where user_id=$1",
    [beforeUser]
  );
  assert.equal(rows.rows.length, 1);
  const client = createPostgrestShim(db) as unknown as Pick<
    typeof supabaseAdmin,
    "from"
  >;
  const id = String(rows.rows[0].id);
  const saved = await loadConnectionRecoveryRequest(id, beforeUser, client);
  assert.equal(saved?.resume_text, "List repositories");
  assert.equal(saved?.dispatched_at, null);
  assert.equal(saved?.payload.eventId, "Ev-connection-seed");
  assert.deepEqual(saved?.target, { provider: "github", access: "read" });
  await markConnectionRecoveryDispatched(id, beforeUser, client);
  assert.ok(
    (await loadConnectionRecoveryRequest(id, beforeUser, client))?.dispatched_at
  );
}
