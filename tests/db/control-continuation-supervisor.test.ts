import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { controlContinuationDatabase } from "../support/control-continuation-database";
import { superviseControlContinuation } from "@/lib/control/continuation-supervisor";
import { loadControlContinuation } from "@/lib/control/continuation-store";

async function fixture() {
  const f = await controlContinuationDatabase("neon");
  const client = f.client as unknown as Parameters<
    typeof loadControlContinuation
  >[2];
  const { continuation } = await f.rpc<{ continuation: { id: string } }>(
    "control_register_continuation",
    f.registerArgs
  );
  await f.db
    .exec(`alter table ai_calls add column status text default 'success',
    add column error text, add column completed_at timestamptz,
    add column started_at timestamptz default now(), add column duration_ms integer,
    add column control_state text default 'active', add column output_tokens integer default 123;`);
  const callId = randomUUID();
  await f.db.query(
    "insert into ai_calls(id,user_id,status) values ($1,$2,'streaming')",
    [callId, f.owner]
  );
  await f.db.query(
    "update control_continuations set status='running',runtime_run_id='supervisor',resume_ai_call_id=$2 where id=$1",
    [continuation.id, callId]
  );
  const payload = { userId: f.owner, continuationId: continuation.id };
  const read = () => loadControlContinuation(f.owner, continuation.id, client);
  const readCall = async () =>
    (
      await f.db.query<{
        status: string;
        completed_at: Date | null;
        output_tokens: number;
      }>("select * from ai_calls where id=$1", [callId])
    ).rows[0];
  const setStatus = (status: string) =>
    f.db.query("update control_continuations set status=$2 where id=$1", [
      continuation.id,
      status,
    ]);
  return { ...f, client, payload, callId, read, readCall, setStatus };
}

it.each([
  "MAX_DURATION_EXCEEDED",
  "TASK_PROCESS_EXITED_WITH_NON_ZERO_CODE",
  "SYSTEM_FAILURE",
])(
  "%s stops the coordinator without worker hooks and preserves saved output",
  async (code) => {
    const f = await fixture();
    try {
      await f.checkpointParent();
      const before = (
        await f.db.query("select messages from control_sessions where id=$1", [
          f.sessionId,
        ])
      ).rows;
      let deliveries = 0;
      const deps = {
        client: f.client,
        // Provider boundary: the process died; no JS catch/finally/hook ran.
        waitForWorker: async () => {
          deliveries++;
          return { ok: false, error: { code } };
        },
      };
      const result = await superviseControlContinuation(
        f.payload,
        "supervisor",
        deps
      );
      expect(result.status).toBe("failed");
      expect(await f.read()).toMatchObject({
        status: "failed",
        error: expect.stringContaining(
          code === "MAX_DURATION_EXCEEDED" ? "time limit" : "not replayed"
        ),
      });
      expect(await f.readCall()).toMatchObject({
        status: "failed",
        completed_at: expect.any(Date),
        output_tokens: 123,
      });
      expect(
        (
          await f.db.query("select status from ai_calls where id=$1", [
            f.parentCallId,
          ])
        ).rows
      ).toEqual([{ status: "success" }]);
      expect(
        (
          await f.db.query(
            "select messages from control_sessions where id=$1",
            [f.sessionId]
          )
        ).rows
      ).toEqual(before);
      await superviseControlContinuation(f.payload, "supervisor", deps);
      expect(deliveries).toBe(1);
    } finally {
      await f.db.close();
    }
  }
);

it.each(["finished", "needs_input", "cancelled"])(
  "supervisor preserves %s after the worker ends",
  async (status) => {
    const f = await fixture();
    try {
      const result = await superviseControlContinuation(
        f.payload,
        "supervisor",
        {
          client: f.client,
          waitForWorker: async () => {
            await f.setStatus(status);
            if (status !== "cancelled")
              await f.db.query(
                "update ai_calls set status='success' where id=$1",
                [f.callId]
              );
            return { ok: status !== "cancelled" };
          },
        }
      );
      expect(result.status).toBe(status);
      expect((await f.read())?.status).toBe(status);
      expect((await f.readCall()).status).toBe(
        status === "cancelled" ? "cancelled" : "success"
      );
    } finally {
      await f.db.close();
    }
  }
);

it("wrong owner or runtime cannot start or finalize a coordinator", async () => {
  const f = await fixture();
  const noWorker = async () => {
    throw new Error("must not start a worker");
  };
  try {
    for (const [payload, runtime] of [
      [{ ...f.payload, userId: randomUUID() }, "supervisor"],
      [f.payload, "other-runtime"],
    ] as const) {
      expect(
        await superviseControlContinuation(payload, runtime, {
          client: f.client,
          waitForWorker: noWorker,
        })
      ).toEqual({ status: "not_claimed" });
    }
    expect((await f.read())?.status).toBe("running");
    expect((await f.readCall()).status).toBe("streaming");
  } finally {
    await f.db.close();
  }
});

it("a supervisor retry reuses the child and reconciles a previously missed terminal write", async () => {
  const f = await fixture();
  const children = new Set<string>();
  let unavailable = true;
  try {
    const deps = {
      client: f.client,
      waitForWorker: async (_payload: object, key: string) => {
        children.add(key);
        if (unavailable) {
          unavailable = false;
          throw new Error("Provider receipt connection interrupted");
        }
        return { ok: true }; // Exited without final persistence is not success.
      },
    };
    await expect(
      superviseControlContinuation(f.payload, "supervisor", deps)
    ).rejects.toThrow("interrupted");
    expect((await f.read())?.status).toBe("running");
    expect(
      (await superviseControlContinuation(f.payload, "supervisor", deps)).status
    ).toBe("failed");
    expect(children.size).toBe(1);
    expect((await f.readCall()).status).toBe("failed");
  } finally {
    await f.db.close();
  }
});
