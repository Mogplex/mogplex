import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import {
  stopIdleWorker,
  type IdleWorkerDeps,
} from "@/lib/zombies/zombie-reaper-workers";

let pg: PGlite;
let client: SupabaseClient;

beforeEach(async () => {
  pg = await PGlite.create();
  await pg.exec(`
    create table external_agent_runs(id text primary key, ai_call_id text, user_id text,
      runtime_provider text, runtime_run_id text, sandbox_record_id text, status text);
    create table control_continuations(id text, resume_ai_call_id text, user_id text, status text,
      runtime_run_id text);
  `);
  const queryable: Queryable = {
    query: async (text, values) => {
      const result = await pg.query(text, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
  client = createPostgrestShim(queryable) as unknown as SupabaseClient;
});

afterEach(async () => {
  await pg.close();
});

function fakeTrigger(
  runs: Record<string, Awaited<ReturnType<IdleWorkerDeps["retrieveRun"]>>>
) {
  const cancelled: string[] = [];
  const killed: string[] = [];
  const finalized: Array<{ runId: string; error: string | null }> = [];
  const reconciled: string[] = [];
  const deps: IdleWorkerDeps = {
    retrieveRun: async (id) => {
      const run = runs[id];
      if (!run) throw new Error(`unknown run ${id}`);
      return run;
    },
    cancelRun: async (id) => {
      cancelled.push(id);
    },
    killCommand: async (input) => {
      killed.push(input.runtimeCommandId);
    },
    finalizeRun: async (run, completion) => {
      finalized.push({ runId: run.id, error: completion.error });
      return null;
    },
    reconcileContinuation: async (payload, supervisorRunId) => {
      reconciled.push(`${payload.continuationId}@${supervisorRunId}`);
    },
  };
  return { deps, cancelled, killed, finalized, reconciled };
}

const error = "Stopped after 360 minutes with no progress.";

describe("stopIdleWorker", () => {
  it("should cancel only the live worker of an external run and kill its command", async () => {
    await pg.exec(
      "insert into external_agent_runs values ('run-1','call-1','owner','trigger','run_sup','sbx-1','streaming')"
    );
    const trigger = fakeTrigger({
      run_sup: {
        id: "run_sup",
        status: "WAITING",
        taskIdentifier: "execute-external-agent-run",
        relatedRuns: {
          children: [
            {
              id: "run_old",
              status: "CRASHED",
              taskIdentifier: "execute-external-agent-run-worker",
            },
            {
              id: "run_live",
              status: "EXECUTING",
              taskIdentifier: "execute-external-agent-run-worker",
            },
            {
              id: "run_other",
              status: "EXECUTING",
              taskIdentifier: "deliver-slack-run-update",
            },
          ],
        },
      },
    });

    const stopped = await stopIdleWorker(
      {
        client,
        call: { id: "call-1", user_id: "owner", runtime_command_id: "cmd-1" },
        error,
      },
      trigger.deps
    );

    expect(stopped).toBe(true);
    expect(trigger.cancelled).toEqual(["run_live"]);
    expect(trigger.killed).toEqual(["cmd-1"]);
    expect(trigger.finalized).toEqual([]);
  });

  it("should cancel and finalize a resume, which has no supervisor", async () => {
    await pg.exec(
      "insert into external_agent_runs values ('run-2','call-2','owner','trigger','run_resume',null,'streaming')"
    );
    const trigger = fakeTrigger({
      run_resume: {
        id: "run_resume",
        status: "EXECUTING",
        taskIdentifier: "execute-resume-agent-run",
      },
    });

    const stopped = await stopIdleWorker(
      { client, call: { id: "call-2", user_id: "owner" }, error },
      trigger.deps
    );

    expect(stopped).toBe(true);
    expect(trigger.cancelled).toEqual(["run_resume"]);
    expect(trigger.finalized).toEqual([{ runId: "run-2", error }]);
  });

  it("should cancel the live worker of a Control continuation", async () => {
    await pg.exec(
      "insert into control_continuations values ('ticket-3','call-3','owner','running','run_ctl')"
    );
    const trigger = fakeTrigger({
      run_ctl: {
        id: "run_ctl",
        status: "WAITING",
        taskIdentifier: "execute-control-continuation",
        relatedRuns: {
          children: [
            {
              id: "run_ctl_worker",
              status: "EXECUTING",
              taskIdentifier: "execute-control-continuation-worker",
            },
          ],
        },
      },
    });

    const stopped = await stopIdleWorker(
      { client, call: { id: "call-3", user_id: "owner" }, error },
      trigger.deps
    );

    expect(stopped).toBe(true);
    expect(trigger.cancelled).toEqual(["run_ctl_worker"]);
  });

  it("should leave another user's run and calls without a worker alone", async () => {
    await pg.exec(
      "insert into external_agent_runs values ('run-4','call-4','someone-else','trigger','run_sup','sbx','streaming')"
    );
    const trigger = fakeTrigger({});

    const stopped = await stopIdleWorker(
      { client, call: { id: "call-4", user_id: "owner" }, error },
      trigger.deps
    );

    expect(stopped).toBe(false);
    expect(trigger.cancelled).toEqual([]);
  });

  it("should finalize a run whose supervisor already ended", async () => {
    await pg.exec(
      "insert into external_agent_runs values ('run-5','call-5','owner','trigger','run_gone',null,'streaming')"
    );
    const trigger = fakeTrigger({
      run_gone: {
        id: "run_gone",
        status: "CRASHED",
        taskIdentifier: "execute-external-agent-run",
      },
    });

    const stopped = await stopIdleWorker(
      { client, call: { id: "call-5", user_id: "owner" }, error },
      trigger.deps
    );

    expect(stopped).toBe(true);
    expect(trigger.cancelled).toEqual([]);
    expect(trigger.finalized).toEqual([{ runId: "run-5", error }]);
  });

  it("should reconcile a continuation whose supervisor already ended", async () => {
    await pg.exec(
      "insert into control_continuations values ('ticket-6','call-6','owner','running','run_ctl_gone')"
    );
    const trigger = fakeTrigger({
      run_ctl_gone: {
        id: "run_ctl_gone",
        status: "COMPLETED",
        taskIdentifier: "execute-control-continuation",
      },
    });

    expect(
      await stopIdleWorker(
        { client, call: { id: "call-6", user_id: "owner" }, error },
        trigger.deps
      )
    ).toBe(true);
    expect(trigger.reconciled).toEqual(["ticket-6@run_ctl_gone"]);
  });

  it("should leave finished runs, finished continuations and unrelated tasks alone", async () => {
    await pg.exec(`
      insert into external_agent_runs values ('run-7','call-7','owner','trigger','run_sup','sbx','failed');
      insert into external_agent_runs values ('run-8','call-8','owner','trigger','run_misc',null,'streaming');
      insert into control_continuations values ('ticket-9','call-9','owner','finished','run_ctl');
    `);
    const trigger = fakeTrigger({
      run_misc: {
        id: "run_misc",
        status: "EXECUTING",
        taskIdentifier: "sync-models",
      },
    });

    for (const id of ["call-7", "call-8", "call-9"]) {
      expect(
        await stopIdleWorker(
          { client, call: { id, user_id: "owner" }, error },
          trigger.deps
        )
      ).toBe(false);
    }
    expect(trigger.cancelled).toEqual([]);
    expect(trigger.finalized).toEqual([]);
    expect(trigger.reconciled).toEqual([]);
  });

  it("should throw when the run state can't be read", async () => {
    await pg.exec("drop table external_agent_runs");
    await expect(
      stopIdleWorker(
        { client, call: { id: "call-1", user_id: "owner" }, error },
        fakeTrigger({}).deps
      )
    ).rejects.toThrow("Could not read the external run");
  });
});
