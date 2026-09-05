import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { controlContinuationDatabase } from "../support/control-continuation-database";
import { listControlContinuations } from "@/lib/control/continuation-store";

it("the live summary reads every active handoff or the latest history, without private execution context", async () => {
  const f = await controlContinuationDatabase("neon");
  const client = f.client as unknown as Parameters<
    typeof listControlContinuations
  >[2];
  try {
    const { continuation } = await f.rpc<{ continuation: { id: string } }>(
      "control_register_continuation",
      f.registerArgs
    );
    const extra = async (status: string, seconds: number) =>
      (
        await f.db.query<{ id: string }>(
          `insert into control_continuations(user_id,session_id,parent_ai_call_id,origin_message,worker_run_ids,request_context,instruction,status,created_at)
       select user_id,session_id,$2,origin_message,worker_run_ids,'{"hidden":"large private execution context"}',instruction,$3,created_at + $4 * interval '1 second'
       from control_continuations where id=$1 returning id`,
          [continuation.id, randomUUID(), status, seconds]
        )
      ).rows[0].id;
    await extra("failed", 1);
    const running = await extra("running", 2);
    const latest = await extra("finished", 3);
    const active = await listControlContinuations(f.owner, f.sessionId, client);
    expect(active.map((row) => row.id)).toEqual([running, continuation.id]);
    expect(Object.keys(active[0]).sort()).toEqual([
      "error",
      "id",
      "parent_ready",
      "status",
      "updated_at",
      "worker_run_ids",
    ]);
    await f.db.query(
      "update control_continuations set status='finished' where id=any($1)",
      [[running, continuation.id]]
    );
    const history = await listControlContinuations(
      f.owner,
      f.sessionId,
      client
    );
    expect(history.map((row) => row.id)).toEqual([latest]);
    expect(
      await listControlContinuations(randomUUID(), f.sessionId, client)
    ).toEqual([]);
  } finally {
    await f.db.close();
  }
});
