import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tool, jsonSchema } from "ai";
import { controlTranscriptDatabase } from "../support/control-transcript-database";
import {
  claimControlTurn,
  assertControlTurnCurrent,
} from "@/lib/control/turn-store";
import { superviseControlTurn } from "@/lib/control/turn-supervisor";
import { journalControlTools } from "@/lib/control/tool-journal";
import { createControlTurnsHandler } from "@/app/api/control/turns/route";

async function fixture() {
  const f = await controlTranscriptDatabase();
  await f.db.exec(`alter table control_sessions add column repo_id uuid;
    create table ai_calls(id uuid primary key, user_id uuid, conversation_id uuid, metadata jsonb default '{"surface":"control"}', status text default 'pending', control_state text default 'active', started_at timestamptz default now(), completed_at timestamptz, duration_ms integer, error text, output_tokens integer default 123);`);
  await f.db.exec(
    await readFile(
      new URL(
        "../../neon/migrations/20261011134900_control_durable_turns.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  const callId = randomUUID();
  await f.db.query(
    "insert into ai_calls(id,user_id,conversation_id) values($1,$2,$3)",
    [callId, f.owner, f.sessionId]
  );
  await f.db.query(
    "insert into control_turns(ai_call_id,user_id,session_id,request_context) values($1,$2,$3,$4)",
    [
      callId,
      f.owner,
      f.sessionId,
      JSON.stringify({ messages: [], missionId: f.sessionId }),
    ]
  );
  return { ...f, callId, payload: { userId: f.owner, aiCallId: callId } };
}

it("observes only the owner's active conversation with the latest saved artifact evidence", async () => {
  const f = await fixture();
  try {
    await f.save([{ id: `control-${f.callId}`, role: "assistant", parts: [] }]);
    const snapshot = {
      sandboxId: "sandbox",
      capturedAt: new Date().toISOString(),
      files: [],
    };
    await f.db.query("update ai_calls set metadata=metadata || $1::jsonb", [
      JSON.stringify({ workspace_changes: snapshot }),
    ]);
    const request = new Request(
      `https://app.test/api/control/turns?sessionId=${f.sessionId}`
    );
    const handler = createControlTurnsHandler({
      requireUserId: async () => f.owner,
      client: f.client,
    });
    const result = await handler(request);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      call: { id: f.callId, status: "pending" },
      messages: [{ metadata: { workspace_changes: snapshot } }],
    });
    const other = createControlTurnsHandler({
      requireUserId: async () => randomUUID(),
      client: f.client,
    });
    expect((await other(request)).status).toBe(404);
    await f.db.exec("update control_sessions set archived=true");
    expect((await handler(request)).status).toBe(404);
  } finally {
    await f.db.close();
  }
});

it("claims a durable turn once across concurrent deliveries and fences cancellation", async () => {
  const f = await fixture();
  try {
    const claims = await Promise.all([
      claimControlTurn(f.owner, f.callId, "runtime", f.client),
      claimControlTurn(f.owner, f.callId, "runtime", f.client),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const turn = claims.find(Boolean)!;
    await expect(
      assertControlTurnCurrent(turn, "runtime", f.client)
    ).resolves.toBeUndefined();
    expect(
      await claimControlTurn(randomUUID(), f.callId, "attacker", f.client)
    ).toBeNull();
    await f.db.query(
      "update ai_calls set control_state='cancel_requested' where id=$1",
      [f.callId]
    );
    await expect(
      assertControlTurnCurrent(turn, "runtime", f.client)
    ).rejects.toThrow(/No further action/);
    expect(
      await claimControlTurn(f.owner, f.callId, "other", f.client)
    ).toBeNull();
  } finally {
    await f.db.close();
  }
});

it("reconciles a killed worker without replay and preserves partial usage and conversation evidence", async () => {
  const f = await fixture();
  try {
    await f.save([
      {
        id: "partial",
        role: "assistant",
        parts: [
          { type: "text", text: "Tests passed; build is still unverified." },
        ],
      },
    ]);
    let attempts = 0;
    const worker = async () => {
      attempts++;
      await claimControlTurn(f.owner, f.callId, "runtime", f.client);
      return {
        ok: false,
        error: { code: "TASK_PROCESS_EXITED_WITH_NON_ZERO_CODE" },
      };
    };
    expect(
      await superviseControlTurn(f.payload, "runtime", worker, f.client)
    ).toEqual({ status: "failed" });
    await superviseControlTurn(f.payload, "runtime", worker, f.client);
    expect(attempts).toBe(1);
    const call = (
      await f.db.query(
        "select status,output_tokens,completed_at from ai_calls where id=$1",
        [f.callId]
      )
    ).rows[0];
    expect(call).toMatchObject({
      status: "failed",
      output_tokens: 123,
      completed_at: expect.any(Date),
    });
    const saved = await f.save([]);
    expect(saved.messages).toHaveLength(2);
    expect(JSON.stringify(saved.messages)).toContain(
      "build is still unverified"
    );
    expect(JSON.stringify(saved.messages)).toContain(
      "agent stopped before finishing"
    );
  } finally {
    await f.db.close();
  }
});

it("durably records tool intent before dispatch and will not replay an uncertain action", async () => {
  const f = await fixture();
  try {
    let effects = 0;
    const tools = journalControlTools(
      {
        write_file: tool({
          inputSchema: jsonSchema<{}>({ type: "object" }),
          execute: async () => {
            expect(
              (
                await f.db.query(
                  "select state,input from control_tool_executions"
                )
              ).rows
            ).toEqual([
              {
                state: "started",
                input: {
                  path: "lib/supabase/run-gallery.tsx",
                  password: "[redacted]",
                },
              },
            ]);
            effects++;
            return { success: false, error: "sandbox_busy" };
          },
        }),
      },
      { userId: f.owner, aiCallId: f.callId },
      f.client
    );
    const options = { toolCallId: "write-1", context: {}, messages: [] };
    const input = {
      path: "lib/supabase/run-gallery.tsx",
      password: "secret-value",
    };
    expect(await tools.write_file.execute!(input, options)).toEqual({
      success: false,
      error: "sandbox_busy",
    });
    await expect(tools.write_file.execute!(input, options)).rejects.toThrow(
      /not executed again/
    );
    expect(effects).toBe(1);
    expect(
      (await f.db.query("select state,output from control_tool_executions"))
        .rows
    ).toEqual([
      { state: "failed", output: { success: false, error: "sandbox_busy" } },
    ]);
    await f.db.exec("set role authenticated");
    await expect(
      f.db.query("select * from control_tool_executions")
    ).rejects.toThrow(/permission denied/);
    await expect(f.db.query("select * from control_turns")).rejects.toThrow(
      /permission denied/
    );
  } finally {
    await f.db.close();
  }
});
