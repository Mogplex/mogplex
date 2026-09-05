import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { controlContinuationDatabase } from "../support/control-continuation-database";

type Ticket = {
  id: string;
  status: string;
  parent_ready: boolean;
  runtime_run_id: string | null;
  request_context: unknown;
  worker_run_ids: string[];
};
type Registered = { status: string; replayed?: boolean; continuation: Ticket };

it.each(["neon", "supabase"] as const)(
  "%s waits for the exact workers and final transcript, then claims once",
  async (root) => {
    const f = await controlContinuationDatabase(root);
    try {
      const registered = await f.rpc<Registered>(
        "control_register_continuation",
        f.registerArgs
      );
      expect(registered.status).toBe("ok");
      const id = registered.continuation.id;
      const args = { p_user_id: f.owner, p_continuation_id: id };
      expect(
        (
          await f.rpc<Registered>(
            "control_register_continuation",
            f.registerArgs
          )
        ).continuation.id
      ).toBe(id);
      expect(
        await f.rpc("control_register_continuation", {
          ...f.registerArgs,
          p_instruction: "Different authority",
        })
      ).toEqual({ status: "conflict" });
      await f.db.query(
        "update external_agent_runs set status='success' where id=any($1)",
        [f.workerIds]
      );
      expect(
        (await f.rpc<Ticket>("control_refresh_continuation", args)).status
      ).toBe("waiting");
      expect(
        await f.rpc("control_claim_continuation", {
          ...args,
          p_runtime_run_id: "too-early",
        })
      ).toBeNull();
      await expect(
        f.rpc("control_refresh_continuation", {
          ...args,
          p_parent_ai_call_id: f.parentCallId,
          p_parent_message: f.parentMessage,
        })
      ).rejects.toThrow("not durable");
      await f.checkpointParent();
      const ready = await f.rpc<Ticket>("control_refresh_continuation", {
        ...args,
        p_parent_ai_call_id: f.parentCallId,
        p_parent_message: f.parentMessage,
      });
      expect(ready.status).toBe("ready");
      expect(ready.request_context).toEqual(f.context);
      const claims = await Promise.all(
        ["runtime-one", "runtime-two"].map((runtime) =>
          f.rpc<Ticket | null>("control_claim_continuation", {
            ...args,
            p_runtime_run_id: runtime,
          })
        )
      );
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)?.status).toBe("running");
      expect(
        await f.rpc("control_claim_continuation", {
          ...args,
          p_runtime_run_id: claims.find(Boolean)!.runtime_run_id,
        })
      ).toBeNull();
      // A later user turn cancels automation in the same transcript transaction.
      await f.rpc("control_save_messages", {
        p_user_id: f.owner,
        p_session_id: f.sessionId,
        p_messages: [
          {
            id: "stop",
            role: "user",
            parts: [{ type: "text", text: "Stop; do not continue." }],
          },
        ],
      });
      expect(
        (await f.rpc<Ticket>("control_refresh_continuation", args)).status
      ).toBe("cancelled");
      expect(
        await f.rpc("control_claim_continuation", {
          ...args,
          p_runtime_run_id: "stale",
        })
      ).toBeNull();
    } finally {
      await f.db.close();
    }
  }
);

it.each(["neon", "supabase"] as const)(
  "%s scopes registration and wakes on failed or input-blocked workers",
  async (root) => {
    const f = await controlContinuationDatabase(root);
    try {
      expect(
        await f.rpc("control_register_continuation", {
          ...f.registerArgs,
          p_user_id: randomUUID(),
        })
      ).toEqual({ status: "not_found" });
      expect(
        await f.rpc("control_register_continuation", {
          ...f.registerArgs,
          p_worker_run_ids: [randomUUID()],
        })
      ).toEqual({ status: "not_found" });
      const foreignWorker = await f.addWorker(await f.mission());
      expect(
        await f.rpc("control_register_continuation", {
          ...f.registerArgs,
          p_worker_run_ids: [foreignWorker],
        })
      ).toEqual({ status: "not_found" });
      expect(
        await f.rpc("control_register_continuation", {
          ...f.registerArgs,
          p_origin_message_id: "old-turn",
        })
      ).toEqual({ status: "superseded" });
      expect(
        await f.rpc("control_register_continuation", {
          ...f.registerArgs,
          p_parent_ai_call_id: randomUUID(),
        })
      ).toEqual({ status: "not_found" });
      for (const workerIds of [[], [f.workerIds[0], f.workerIds[0]], [null]]) {
        expect(
          await f.rpc("control_register_continuation", {
            ...f.registerArgs,
            p_worker_run_ids: workerIds,
          })
        ).toEqual({ status: "invalid" });
      }
      expect(
        await f.rpc("control_register_continuation", {
          ...f.registerArgs,
          p_request_context: { ...f.context, mode: "plan" },
        })
      ).toEqual({ status: "invalid" });
      const { continuation } = await f.rpc<Registered>(
        "control_register_continuation",
        f.registerArgs
      );
      const args = { p_user_id: f.owner, p_continuation_id: continuation.id };
      await f.checkpointParent();
      await f.rpc("control_refresh_continuation", {
        ...args,
        p_parent_ai_call_id: f.parentCallId,
        p_parent_message: f.parentMessage,
      });
      await f.db.query(
        "update external_agent_runs set status='failed' where id=$1",
        [f.workerIds[0]]
      );
      expect(
        (await f.rpc<Ticket>("control_refresh_continuation", args)).status
      ).toBe("waiting");
      await f.db.query(
        "update external_agent_runs set status='awaiting_input' where id=$1",
        [f.workerIds[1]]
      );
      expect(
        (await f.rpc<Ticket>("control_refresh_continuation", args)).status
      ).toBe("ready");
      expect(
        await f.rpc("control_refresh_continuation", {
          ...args,
          p_user_id: randomUUID(),
        })
      ).toBeNull();
      await f.db.query(
        "update control_sessions set archived=true where id=$1",
        [f.sessionId]
      );
      expect(
        (await f.rpc<Ticket>("control_refresh_continuation", args)).status
      ).toBe("cancelled");
      expect(
        await f.rpc("control_claim_continuation", {
          ...args,
          p_runtime_run_id: "archived",
        })
      ).toBeNull();
    } finally {
      await f.db.close();
    }
  }
);
