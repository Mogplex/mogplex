import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { ACTIVE_TEAM_HEADER } from "../../lib/team-capabilities";
import {
  AgentLinkValidationError,
  type AgentLinks,
  type AgentRow,
} from "../../app/api/agents/_lib/store";
import { MogplexApiRunError } from "../../lib/mogplex-api/runs-types";

async function loadRoutes() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const [agents, usage, run] = await Promise.all([
    import("../../app/api/agents/route"),
    import("../../app/api/agents/usage/route"),
    import("../../app/api/agents/run/route"),
  ]);
  return { agents, usage, run };
}

const ME = "user-me";
const TEAMMATE = "user-teammate";
const TEAM = "11111111-1111-4111-8111-111111111111";

function row(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    user_id: ME,
    team_id: null,
    name: "NEXTJS-REVIEWER",
    slug: "nextjs-reviewer",
    model: "anthropic/claude-sonnet-4.5",
    system_prompt: "Review App Router code.",
    description: "App Router review",
    category: "nextjs",
    source_template: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const unauthorized = async () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

function json(
  url: string,
  method: string,
  body?: unknown,
  headers?: HeadersInit
) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const baseDeps = {
  requireUserId: async () => ME,
  resolveDefaultModel: async () => "openai/gpt-5.4",
  ensureCategoryAllowed: async () => null,
  isTeamMember: async (teamId: string, userId: string) =>
    teamId === TEAM && (userId === ME || userId === TEAMMATE),
  loadLinks: async (ids: string[]) =>
    new Map<string, AgentLinks>(
      ids.map((id) => [id, { skill_ids: [`skill-of-${id}`], rule_ids: [] }])
    ),
};

test("GET /api/agents in team scope lists own rows and teammates' shared rows with flags", async () => {
  const { agents } = await loadRoutes();
  let requested: { userId: string; teamId: string | null } | null = null;
  const handler = agents.createAgentsGetHandler({
    ...baseDeps,
    listAgents: async (input) => {
      requested = input;
      return [
        row(),
        row({
          id: "agent-2",
          user_id: TEAMMATE,
          team_id: TEAM,
          name: "Security Sweep",
          slug: "security-sweep",
        }),
      ];
    },
  });
  const response = await handler(
    json("https://example.com/api/agents", "GET", undefined, {
      [ACTIVE_TEAM_HEADER]: TEAM,
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(requested, { userId: ME, teamId: TEAM });
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  const custom = payload.filter((agent) => !agent.is_preset);
  assert.deepEqual(
    custom.map((agent) => [
      agent.id,
      agent.shared,
      agent.owned,
      agent.skill_ids,
    ]),
    [
      ["agent-1", false, true, ["skill-of-agent-1"]],
      ["agent-2", true, false, ["skill-of-agent-2"]],
    ]
  );
  const preset = payload.find((agent) => agent.is_preset);
  assert.equal(preset?.model, "openai/gpt-5.4");
  assert.deepEqual(preset?.skill_ids, []);
});

test("GET /api/agents ignores a team header for a team the user is not in", async () => {
  const { agents } = await loadRoutes();
  let requested: { userId: string; teamId: string | null } | null = null;
  const handler = agents.createAgentsGetHandler({
    ...baseDeps,
    isTeamMember: async () => false,
    listAgents: async (input) => {
      requested = input;
      return [];
    },
  });
  await handler(
    json("https://example.com/api/agents", "GET", undefined, {
      [ACTIVE_TEAM_HEADER]: TEAM,
    })
  );
  assert.deepEqual(requested, { userId: ME, teamId: null });
});

test("POST /api/agents shares with a team only for members and attaches skills and rules", async () => {
  const { agents } = await loadRoutes();
  const inserted: Array<Record<string, unknown>> = [];
  const linked: Array<Record<string, unknown>> = [];
  const handler = agents.createAgentsPostHandler({
    ...baseDeps,
    insertAgent: async (values) => {
      inserted.push(values);
      return row({ team_id: values.team_id as string | null });
    },
    replaceLinks: async (input) => {
      linked.push(input);
    },
  });
  const body = {
    name: "NEXTJS-REVIEWER",
    model: "anthropic/claude-sonnet-4.5",
    category: "nextjs",
    system_prompt: "Review App Router code.",
    team_id: TEAM,
    skill_ids: ["skill-1"],
    rule_ids: ["rule-1"],
  };
  const created = await handler(
    json("https://example.com/api/agents", "POST", body)
  );
  assert.equal(created.status, 200);
  assert.equal(inserted[0]?.team_id, TEAM);
  assert.deepEqual(linked, [
    {
      agentId: "agent-1",
      userId: ME,
      skillIds: ["skill-1"],
      ruleIds: ["rule-1"],
    },
  ]);
  const payload = (await created.json()) as Record<string, unknown>;
  assert.equal(payload.shared, true);
  assert.equal(payload.owned, true);

  const forbidden = await handler(
    json("https://example.com/api/agents", "POST", {
      ...body,
      team_id: "22222222-2222-4222-8222-222222222222",
    })
  );
  assert.equal(forbidden.status, 403);
  assert.equal(inserted.length, 1);

  const malformed = await handler(
    json("https://example.com/api/agents", "POST", {
      ...body,
      skill_ids: "skill-1",
    })
  );
  assert.equal(malformed.status, 400);
});

test("POST /api/agents reports unknown skill ids as a 400 from the link validator", async () => {
  const { agents } = await loadRoutes();
  const handler = agents.createAgentsPostHandler({
    ...baseDeps,
    insertAgent: async () => row(),
    replaceLinks: async () => {
      throw new AgentLinkValidationError("Unknown skills: nope");
    },
  });
  const response = await handler(
    json("https://example.com/api/agents", "POST", {
      name: "X",
      model: "m",
      category: "nextjs",
      skill_ids: ["nope"],
    })
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Unknown skills: nope" });
});

test("PUT /api/agents lets a teammate edit a shared agent but not re-share it, and hides others' personal agents", async () => {
  const { agents } = await loadRoutes();
  const updates: Array<Record<string, unknown>> = [];
  const shared = row({ id: "agent-2", user_id: TEAMMATE, team_id: TEAM });
  const handler = agents.createAgentsPutHandler({
    ...baseDeps,
    loadAgent: async (id) =>
      id === "agent-2"
        ? shared
        : id === "agent-3"
          ? row({ id: "agent-3", user_id: TEAMMATE })
          : null,
    updateAgent: async (id, values) => {
      updates.push({ id, ...values });
      return { ...shared, ...values } as AgentRow;
    },
    replaceLinks: async () => {},
  });

  const edited = await handler(
    json("https://example.com/api/agents", "PUT", {
      id: "agent-2",
      system_prompt: "Tightened prompt",
    })
  );
  assert.equal(edited.status, 200);
  assert.deepEqual(updates, [
    { id: "agent-2", system_prompt: "Tightened prompt" },
  ]);
  const payload = (await edited.json()) as Record<string, unknown>;
  assert.equal(payload.owned, false);
  assert.equal(payload.shared, true);

  const reshared = await handler(
    json("https://example.com/api/agents", "PUT", {
      id: "agent-2",
      team_id: null,
    })
  );
  assert.equal(reshared.status, 403);

  const hidden = await handler(
    json("https://example.com/api/agents", "PUT", {
      id: "agent-3",
      name: "Mine now",
    })
  );
  assert.equal(hidden.status, 404);
  assert.equal(updates.length, 1);
});

test("PUT /api/agents lets the owner share and unshare within their teams", async () => {
  const { agents } = await loadRoutes();
  const updates: Array<Record<string, unknown>> = [];
  const handler = agents.createAgentsPutHandler({
    ...baseDeps,
    loadAgent: async () => row(),
    updateAgent: async (id, values) => {
      updates.push({ id, ...values });
      return { ...row(), ...values } as AgentRow;
    },
  });
  const shared = await handler(
    json("https://example.com/api/agents", "PUT", {
      id: "agent-1",
      team_id: TEAM,
    })
  );
  assert.equal(shared.status, 200);
  assert.equal(((await shared.json()) as { shared: boolean }).shared, true);
  const elsewhere = await handler(
    json("https://example.com/api/agents", "PUT", {
      id: "agent-1",
      team_id: "22222222-2222-4222-8222-222222222222",
    })
  );
  assert.equal(elsewhere.status, 403);
  assert.deepEqual(updates, [{ id: "agent-1", team_id: TEAM }]);
});

test("agents routes reject unauthenticated callers", async () => {
  const { agents, usage, run } = await loadRoutes();
  for (const response of await Promise.all([
    agents.createAgentsGetHandler({ ...baseDeps, requireUserId: unauthorized })(
      json("https://example.com/api/agents", "GET")
    ),
    agents.createAgentsDeleteHandler({
      ...baseDeps,
      requireUserId: unauthorized,
    })(json("https://example.com/api/agents?id=x", "DELETE")),
    usage.createAgentsUsageGetHandler({ requireUserId: unauthorized })(),
    run.createAgentRunPostHandler({ requireUserId: unauthorized })(
      json("https://example.com/api/agents/run", "POST", {})
    ),
  ])) {
    assert.equal(response.status, 401);
  }
});

test("GET /api/agents/usage maps published automations and recorded runs to agents", async () => {
  const { usage } = await loadRoutes();
  const handler = usage.createAgentsUsageGetHandler({
    requireUserId: async () => ME,
    listPublishedFlows: async () => [
      {
        id: "flow-1",
        name: "PR-Review",
        status: "active",
        graph: { nodes: [{ type: "agent", data: { agentId: "agent-1" } }] },
      },
    ],
    listAgentRuns: async () => [
      { agent_id: "agent-1", created_at: "2026-09-17T00:00:00.000Z" },
    ],
  });
  const response = await handler();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    "agent-1": {
      automations: [{ id: "flow-1", name: "PR-Review", status: "active" }],
      runs: 1,
      lastRunAt: "2026-09-17T00:00:00.000Z",
    },
  });
});

test("POST /api/agents/run starts a run as the agent for the session user", async () => {
  const { run } = await loadRoutes();
  const starts: Array<Record<string, unknown>> = [];
  const handler = run.createAgentRunPostHandler({
    requireUserId: async () => ME,
    startRun: async (input) => {
      starts.push(input as unknown as Record<string, unknown>);
      return {
        replayed: false,
        run: { runId: "run-1", agentId: "agent-1" },
      } as unknown as Awaited<ReturnType<typeof run.POST>> extends never
        ? never
        : never;
    },
  });
  const response = await handler(
    json("https://example.com/api/agents/run", "POST", {
      agentId: "agent-1",
      repoId: "repo-1",
      prompt: "Audit the auth routes",
      harness: "codex",
    })
  );
  assert.equal(response.status, 201);
  const start = starts[0] as {
    user: { userId: string; keyId: string };
    origin: string;
    idempotencyKey: string;
    body: { agentId: string; createBranch: boolean };
  };
  assert.equal(start.user.userId, ME);
  assert.equal(start.user.keyId, "app:agents");
  assert.equal(start.origin, "app");
  assert.match(start.idempotencyKey, /^app:/);
  assert.equal(start.body.agentId, "agent-1");
  assert.equal(start.body.createBranch, true);
});

test("POST /api/agents/run validates input and surfaces run errors with their status", async () => {
  const { run } = await loadRoutes();
  const missingAgent = await run.createAgentRunPostHandler({
    requireUserId: async () => ME,
    startRun: async () => {
      throw new Error("must not start");
    },
  })(json("https://example.com/api/agents/run", "POST", { repoId: "repo-1" }));
  assert.equal(missingAgent.status, 400);

  const notFound = await run.createAgentRunPostHandler({
    requireUserId: async () => ME,
    startRun: async () => {
      throw new MogplexApiRunError("NOT_FOUND", "Agent not found", 404);
    },
  })(
    json("https://example.com/api/agents/run", "POST", {
      agentId: "nope",
      repoId: "repo-1",
      prompt: "x",
    })
  );
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), { error: "Agent not found" });
});
