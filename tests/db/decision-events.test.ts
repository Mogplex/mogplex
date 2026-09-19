import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import {
  toDecisionEventRow,
  type DecisionEventRecord,
} from "@/lib/decisions/record";

const owner = "00000000-0000-4000-8000-0000000000d1";
const aiCall = "00000000-0000-4000-8000-0000000000d2";

const event: DecisionEventRecord = {
  decisionId: "command_risk",
  questionVersion: "2026-09-19.1",
  mode: "enforce",
  status: "ok",
  scope: {
    surface: "control",
    userId: owner,
    aiCallId: aiCall,
    conversationId: "conv-1",
  },
  state: { command: "git push --force origin main" },
  questions: {
    risk: { type: "score", instructions: "q", criteria: ["a", "b"] },
  },
  answers: {
    risk: { type: "score", score: 2.96, probabilities: { "3": 0.96 } },
  },
  confidence: { risk: 0.95 },
  verdict: "remote_destructive",
  acted: true,
  baseline: { guardBlocked: false },
  usage: { latencyMs: 214, inputTokens: 260, costUsd: 0.000011, model: "eval" },
  escalated: true,
  escalationAnswers: { risk: { type: "score", score: 3 } },
  escalationUsage: {
    latencyMs: 1310,
    inputTokens: 900,
    costUsd: 0.0027,
    model: "lm",
  },
};

describe("decision_events", () => {
  let db: PGlite;
  let client: ReturnType<typeof createPostgrestShim>;

  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    });
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    await db.query("insert into profiles(id) values ($1)", [owner]);
    await db.query(
      "insert into ai_calls(id,user_id,type,model) values ($1,$2,'agent','fixture')",
      [aiCall, owner]
    );
    client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("should store a full decision event written through the app's client", async () => {
    const { error } = await client
      .from("decision_events")
      .insert(toDecisionEventRow(event));
    expect(error).toBeNull();

    const { rows } = await db.query<Record<string, unknown>>(
      "select * from decision_events where user_id = $1",
      [owner]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision_id: "command_risk",
      surface: "control",
      mode: "enforce",
      status: "ok",
      verdict: "remote_destructive",
      acted: true,
      escalated: true,
      ai_call_id: aiCall,
      conversation_id: "conv-1",
      state: { command: "git push --force origin main" },
      baseline: { guardBlocked: false },
      answers: { risk: { score: 2.96 } },
      escalation_answers: { risk: { score: 3 } },
      latency_ms: 214,
      escalation_latency_ms: 1310,
      metadata: {},
    });
    expect(Number(rows[0]?.cost_usd)).toBeCloseTo(0.000011, 9);
  });

  it("should reject modes and statuses the runtime never writes", async () => {
    await expect(
      db.query(
        "insert into decision_events(user_id,surface,decision_id,question_version,mode,status) values ($1,'control','command_risk','v','off','ok')",
        [owner]
      )
    ).rejects.toThrow(/mode/);
    await expect(
      db.query(
        "insert into decision_events(user_id,surface,decision_id,question_version,mode,status) values ($1,'control','command_risk','v','shadow','pending')",
        [owner]
      )
    ).rejects.toThrow(/status/);
  });

  it("should keep the event when its run is deleted and drop it with its owner", async () => {
    await db.query("delete from ai_calls where id = $1", [aiCall]);
    const kept = await db.query<{ ai_call_id: string | null }>(
      "select ai_call_id from decision_events where user_id = $1",
      [owner]
    );
    expect(kept.rows).toEqual([{ ai_call_id: null }]);

    await db.query("delete from profiles where id = $1", [owner]);
    const gone = await db.query(
      "select 1 from decision_events where user_id = $1",
      [owner]
    );
    expect(gone.rows).toHaveLength(0);
  });
});
