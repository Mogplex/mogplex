import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { createDecisionChecksGate } from "@/lib/decisions/account-setting";
import type { CandidateDecideFn } from "@/lib/decisions/candidates";
import { decide } from "@/lib/decisions/decide";
import type { DecisionEvaluator } from "@/lib/decisions/evaluator";
import { observeMemoryRelevance } from "@/lib/decisions/memory-relevance";
import { recordDecisionEvent } from "@/lib/decisions/record";
import { observeSkillSelection } from "@/lib/decisions/skills";
import type { DecisionScope } from "@/lib/decisions/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

const owner = "00000000-0000-4000-8000-000000000160";
const team = "00000000-0000-4000-8000-000000000171";

let db: PGlite;
const previous = new Map<string, PropertyDescriptor | undefined>();
let evaluations = 0;

/** Stands in for the evaluation model only: the second candidate is a no. */
const evaluate: DecisionEvaluator = async (request) => {
  evaluations += 1;
  return {
    ok: true,
    answers: Object.fromEntries(
      Object.keys(request.questions).map((key) => [
        key,
        { type: "boolean" as const, probability: key === "c02" ? 0.03 : 0.92 },
      ])
    ),
    confidence: {},
    usage: { latencyMs: 5, inputTokens: 10, costUsd: 0, model: "test" },
  };
};

/** The real decision path, with only the model and a fresh gate swapped in. */
function realDecide(): CandidateDecideFn {
  const gate = createDecisionChecksGate();
  return (id, state, scope, options) =>
    decide(id, state, scope, options, {
      evaluate,
      escalate: evaluate,
      record: recordDecisionEvent,
      env: {},
      isEnabled: gate,
    });
}

const scope: DecisionScope = {
  surface: "control",
  userId: owner,
  teamId: team,
};

async function events() {
  const { rows } = await db.query<Record<string, unknown>>(
    "select * from decision_events order by created_at"
  );
  return rows;
}

describe("per-candidate checks against the migrated schema", () => {
  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
      parsers: SHIM_TYPE_PARSERS,
    });
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    await db.query("insert into profiles(id) values ($1)", [owner]);
    await db.query(
      "insert into teams(id,name,slug,owner_user_id) values ($1,'Skills','skills-team',$2)",
      [team, owner]
    );
    const shim = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    });
    for (const key of ["from", "rpc"] as const) {
      previous.set(key, Object.getOwnPropertyDescriptor(supabaseAdmin, key));
      Object.defineProperty(supabaseAdmin, key, {
        configurable: true,
        value: shim[key].bind(shim),
      });
    }
  }, 120_000);

  afterAll(async () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(supabaseAdmin, key, descriptor);
      else Reflect.deleteProperty(supabaseAdmin, key);
    }
    await db.close();
  });

  beforeEach(async () => {
    evaluations = 0;
    await db.query("delete from decision_events");
    await db.query("update teams set decision_checks_enabled = true");
  });

  it("should store a skill selection with one question per skill and never act", async () => {
    await observeSkillSelection(
      {
        agent: {
          id: "agent-1",
          name: "Reviewer",
          skills: [
            { id: "s-1", name: "RSC Audit", description: null, content: "A" },
            { id: "s-2", name: "SEO", description: null, content: "B" },
          ],
        },
        request: "Audit client components",
        delivery: "files",
        scope: { ...scope, surface: "harness" },
      },
      realDecide()
    );

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision_id: "skill_selection",
      surface: "harness",
      team_id: team,
      mode: "shadow",
      status: "ok",
      verdict: "some",
      acted: false,
      baseline: { loaded: 2, delivery: "files" },
      metadata: { candidates: { c01: "s-1", c02: "s-2" } },
    });
    expect(Object.keys(rows[0]?.questions as object).sort()).toEqual([
      "anySkill",
      "c01",
      "c02",
    ]);
  });

  it("should store which injected memories were judged irrelevant, next to what was injected", async () => {
    await observeMemoryRelevance(
      {
        request: "Rename the billing page",
        groups: {
          semantic: [{ id: "m-1", content: "Uses pnpm." }],
          episodic: [{ id: "m-2", content: "Moved DNS in August." }],
        },
        scope,
      },
      realDecide()
    );

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision_id: "memory_relevance",
      mode: "shadow",
      verdict: "drop_some",
      acted: false,
      baseline: { injected: 2, byGroup: { semantic: 1, episodic: 1 } },
      state: { memories: { c01: "Uses pnpm.", c02: "Moved DNS in August." } },
      metadata: { candidates: { c02: { id: "m-2", group: "episodic" } } },
    });
  });

  it("should send and store nothing for a team that turned run checks off", async () => {
    await db.query(
      "update teams set decision_checks_enabled = false where id = $1",
      [team]
    );
    const decideFn = realDecide();

    await observeSkillSelection(
      {
        agent: {
          id: "agent-1",
          name: "Reviewer",
          skills: [{ id: "s-1", name: "A", description: null, content: "A" }],
        },
        request: "Audit client components",
        delivery: "inline",
        scope,
      },
      decideFn
    );
    await observeMemoryRelevance(
      {
        request: "Rename the billing page",
        groups: { semantic: [{ id: "m-1", content: "Uses pnpm." }] },
        scope,
      },
      decideFn
    );

    expect(evaluations).toBe(0);
    expect(await events()).toHaveLength(0);
  });
});
