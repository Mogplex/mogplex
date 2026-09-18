import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { expect, test } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import {
  loadAgentLinkedRules,
  loadAgentLinkedSkills,
  listAccessibleAgentRows,
  resolveAgentRuntimeForUser,
} from "@/lib/agents/runtime/store";

const owner = "00000000-0000-4000-8000-000000000001";
const teammate = "00000000-0000-4000-8000-000000000002";
const stranger = "00000000-0000-4000-8000-000000000003";
const team = "00000000-0000-4000-8000-000000000010";
const personalAgent = "00000000-0000-4000-8000-000000000020";
const sharedAgent = "00000000-0000-4000-8000-000000000021";
const skill = "00000000-0000-4000-8000-000000000030";
const rule = "00000000-0000-4000-8000-000000000040";

test("agent runtime schema: team sharing, attached skills and rules, and run attribution", async () => {
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  try {
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    await db.query("insert into profiles(id) values ($1),($2),($3)", [
      owner,
      teammate,
      stranger,
    ]);
    await db.query(
      "insert into teams(id,name,slug,owner_user_id) values ($1,'Acme','acme',$2)",
      [team, owner]
    );
    // Creating a team enrolls its owner; only the teammate needs a row.
    await db.query(
      "insert into team_members(team_id,user_id,role) values ($1,$2,'developer')",
      [team, teammate]
    );
    await db.query(
      "insert into agents(id,user_id,name,slug,system_prompt) values ($1,$2,'Personal','personal','Keep it private')",
      [personalAgent, owner]
    );
    await db.query(
      "insert into agents(id,user_id,team_id,name,slug,system_prompt) values ($1,$2,$3,'Security Sweep','security-sweep','Look for auth bypasses')",
      [sharedAgent, owner, team]
    );
    await db.query(
      "insert into skills(id,user_id,name,description,content) values ($1,$2,'RSC Audit','Find client boundaries','# RSC')",
      [skill, owner]
    );
    await db.query(
      "insert into agent_rules(id,user_id,name,content) values ($1,$2,'No any','Never use any.')",
      [rule, owner]
    );
    await db.query(
      "insert into agent_skill_links(agent_id,skill_id,position) values ($1,$2,0)",
      [sharedAgent, skill]
    );
    await db.query(
      "insert into agent_rule_links(agent_id,rule_id,position) values ($1,$2,0)",
      [sharedAgent, rule]
    );

    // A second shared agent may not reuse the slug inside the same team.
    await expect(
      db.query(
        "insert into agents(user_id,team_id,name,slug) values ($1,$2,'Dup','security-sweep')",
        [teammate, team]
      )
    ).rejects.toThrow(/unique|duplicate/i);

    const client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    }) as unknown as Parameters<typeof listAccessibleAgentRows>[1];

    const forTeammate = await listAccessibleAgentRows(
      { userId: teammate },
      client
    );
    expect(forTeammate.map((row) => row.id)).toEqual([sharedAgent]);
    const forStranger = await listAccessibleAgentRows(
      { userId: stranger },
      client
    );
    expect(forStranger).toEqual([]);

    expect(
      (await loadAgentLinkedSkills(sharedAgent, client)).map((s) => s.name)
    ).toEqual(["RSC Audit"]);
    expect(
      (await loadAgentLinkedRules(sharedAgent, client)).map((r) => r.content)
    ).toEqual(["Never use any."]);

    const runtime = await resolveAgentRuntimeForUser(
      { agentId: sharedAgent, userId: teammate },
      client
    );
    expect(runtime).toMatchObject({
      name: "Security Sweep",
      teamId: team,
      ownerUserId: owner,
    });
    expect(runtime?.skills.map((s) => s.content)).toEqual(["# RSC"]);
    expect(
      await resolveAgentRuntimeForUser(
        { agentId: personalAgent, userId: teammate },
        client
      )
    ).toBeNull();

    // Runs remember the agent; deleting the agent keeps the run.
    const repo = "00000000-0000-4000-8000-000000000050";
    const call = "00000000-0000-4000-8000-000000000051";
    await db.query(
      "insert into workspaces(id,user_id,owner_user_id,name) values ($1,$2,$2,'Widgets')",
      [repo, owner]
    );
    await db.query(
      "insert into repos(id,user_id,owner_user_id,workspace_id,full_name,owner,name) values ($1,$2,$2,$1,'acme/widgets','acme','widgets')",
      [repo, owner]
    );
    await db.query(
      "insert into ai_calls(id,user_id,type,model,repo_id) values ($1,$2,'agent','fixture',$3)",
      [call, owner, repo]
    );
    await db.query(
      "insert into external_agent_runs(id,user_id,repo_id,ai_call_id,idempotency_key,request_hash,harness,status,prompt,base_branch,working_branch,agent_id) values ($1,$2,$3,$1,'k','h','codex','pending','Audit','main','fix/audit',$4)",
      [call, owner, repo, sharedAgent]
    );
    await db.query("delete from agents where id = $1", [sharedAgent]);
    const { rows } = await db.query<{ agent_id: string | null }>(
      "select agent_id from external_agent_runs where id = $1",
      [call]
    );
    expect(rows).toEqual([{ agent_id: null }]);
    const links = await db.query("select 1 from agent_skill_links");
    expect(links.rows).toEqual([]);
  } finally {
    await db.close();
  }
});
