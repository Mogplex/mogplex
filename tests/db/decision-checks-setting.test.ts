import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTeamDecisionChecksHandlers } from "@/app/api/teams/[teamId]/decision-checks/route";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { createDecisionChecksGate } from "@/lib/decisions/account-setting";
import {
  classify,
  CLASSIFY_TURNED_OFF_MESSAGE,
} from "@/lib/decisions/classify";
import { decide } from "@/lib/decisions/decide";
import type { DecisionEvaluator } from "@/lib/decisions/evaluator";
import { recordDecisionEvent } from "@/lib/decisions/record";
import type { DecisionAnswers, DecisionScope } from "@/lib/decisions/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

const teamOwner = "00000000-0000-4000-8000-000000000060";
const admin = "00000000-0000-4000-8000-000000000061";
const developer = "00000000-0000-4000-8000-000000000062";
const team = "00000000-0000-4000-8000-000000000071";

let db: PGlite;
const previous = new Map<string, PropertyDescriptor | undefined>();
let evaluations = 0;

/** Stands in for the evaluation model only; everything else is real. */
const evaluate: DecisionEvaluator = async (request) => {
  evaluations += 1;
  const isClassify = request.decisionId === "flow_classify";
  const answers: DecisionAnswers = isClassify
    ? { answer: { type: "boolean", probability: 0.97 } }
    : { risk: { type: "score", score: 3, probabilities: { "3": 0.99 } } };
  const confidence: Record<string, number> = isClassify
    ? { answer: 0.97 }
    : { risk: 0.99 };
  return {
    ok: true,
    answers,
    confidence,
    usage: { latencyMs: 5, inputTokens: 10, costUsd: 0, model: "test" },
  };
};

function riskCheck(scope: DecisionScope, gate = createDecisionChecksGate()) {
  return decide(
    "command_risk",
    { command: "git push --force origin main" },
    scope,
    {},
    {
      evaluate,
      escalate: evaluate,
      record: recordDecisionEvent,
      env: {},
      isEnabled: gate,
    }
  );
}

async function eventCount() {
  const { rows } = await db.query<{ count: number }>(
    "select count(*)::int as count from decision_events"
  );
  return rows[0]?.count ?? 0;
}

const teamScope: DecisionScope = {
  surface: "control",
  userId: developer,
  teamId: team,
};
const personalScope: DecisionScope = { surface: "control", userId: developer };

describe("the run checks setting against the migrated schema", () => {
  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
      parsers: SHIM_TYPE_PARSERS,
    });
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);

    await db.query("insert into profiles(id) values ($1),($2),($3)", [
      teamOwner,
      admin,
      developer,
    ]);
    await db.query(
      "insert into teams(id,name,slug,owner_user_id) values ($1,'Checks','checks-team',$2)",
      [team, teamOwner]
    );
    // Creating a team already enrolls its owner; add the other two roles.
    await db.query(
      `insert into team_members(team_id,user_id,role) values
         ($1,$2,'admin'),($1,$3,'developer')`,
      [team, admin, developer]
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
    await db.query("update profiles set decision_checks_enabled = true");
  });

  it("should be on for every existing team and profile after the migration", async () => {
    const { rows } = await db.query<{ enabled: boolean }>(
      `select decision_checks_enabled as enabled from teams
       union all select decision_checks_enabled from profiles`
    );

    expect(rows.map((row) => row.enabled)).toEqual([true, true, true, true]);
  });

  it("should evaluate and record a team's work while the team has checks on", async () => {
    const outcome = await riskCheck(teamScope);

    expect(outcome).toMatchObject({ status: "ok", act: true });
    expect(evaluations).toBe(1);
    expect(await eventCount()).toBe(1);
  });

  it("should send and store nothing for a team that turned checks off, whatever the member's own setting", async () => {
    await db.query(
      "update teams set decision_checks_enabled = false where id = $1",
      [team]
    );

    const outcome = await riskCheck(teamScope);

    expect(outcome).toMatchObject({ status: "off", act: false });
    expect(evaluations).toBe(0);
    expect(await eventCount()).toBe(0);
  });

  it("should keep a person's own choice separate from their team's", async () => {
    await db.query(
      "update profiles set decision_checks_enabled = false where id = $1",
      [developer]
    );

    const personal = await riskCheck(personalScope);
    const inTeam = await riskCheck(teamScope);

    expect(personal.status).toBe("off");
    expect(inTeam.status).toBe("ok");
    expect(evaluations).toBe(1);
  });

  it("should fail a Classify node instead of choosing a branch when checks are off", async () => {
    await db.query(
      "update teams set decision_checks_enabled = false where id = $1",
      [team]
    );
    const request = {
      question: "Is this a bug report?",
      output: { kind: "boolean" as const },
      state: "The login page crashes.",
      scope: { ...teamScope, surface: "automation" },
    };
    const deps = { evaluate, record: recordDecisionEvent, env: {} };

    const off = await classify(request, {
      ...deps,
      isEnabled: createDecisionChecksGate(),
    });
    await db.query(
      "update teams set decision_checks_enabled = true where id = $1",
      [team]
    );
    const on = await classify(request, {
      ...deps,
      isEnabled: createDecisionChecksGate(),
    });

    expect(off).toEqual({ ok: false, message: CLASSIFY_TURNED_OFF_MESSAGE });
    expect(on).toMatchObject({ ok: true, result: { answer: true } });
    expect(evaluations).toBe(1);
  });

  it("should let an admin switch it off through the route, apply at once, and audit it, while a developer cannot", async () => {
    const gate = createDecisionChecksGate();
    expect((await riskCheck(teamScope, gate)).status).toBe("ok");
    const handlersFor = (profileId: string) =>
      createTeamDecisionChecksHandlers({
        requireProfileId: async () => profileId,
        forget: gate.forget,
      });
    const context = { params: Promise.resolve({ teamId: team }) };
    const turnOff = () =>
      new Request("https://mogplex.test/api", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });

    const refused = await handlersFor(developer).PATCH(turnOff(), context);
    const accepted = await handlersFor(admin).PATCH(turnOff(), context);
    const after = await riskCheck(teamScope, gate);

    expect(refused.status).toBe(403);
    expect(accepted.status).toBe(200);
    expect(after.status).toBe("off");
    const { rows } = await db.query<{ action: string; payload: unknown }>(
      "select action, payload from team_audit_events where team_id = $1",
      [team]
    );
    expect(rows).toEqual([
      {
        action: "decision_checks.changed",
        payload: { from_enabled: true, to_enabled: false },
      },
    ]);
  });
});
