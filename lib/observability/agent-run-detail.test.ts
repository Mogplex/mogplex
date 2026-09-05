import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { loadAgentRunDetail } from "./agent-run-detail";
import { loadAgentRunRowsFromDb } from "./agent-run-jobs";

function fixture(
  options: { missing?: string; error?: string; list?: boolean } = {}
) {
  const urls: URL[] = [];
  const run = {
    id: "run",
    user_id: "owner",
    repo_id: "repo",
    ai_call_id: "call",
    status: "streaming",
    harness: "mogplex",
    prompt: "Fix mobile controls",
    working_branch: "fix/mobile",
    base_branch: "main",
    metadata: {},
    created_at: "2026-09-05T10:00:00Z",
    updated_at: "2026-09-05T10:01:00Z",
  };
  const event = {
    id: "event",
    ai_call_id: "call",
    user_id: "owner",
    message: "Completed",
    payload: { kind: "assistant_final" },
    created_at: "2026-09-05T10:01:00Z",
  };
  const client = createClient("https://database.example.test", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url) => {
        const parsed = new URL(String(url));
        urls.push(parsed);
        const table = parsed.pathname.split("/").at(-1);
        // Model the database boundary: a missing ownership or identity predicate
        // cannot return the selected user's row.
        if (parsed.searchParams.get("user_id") !== "eq.owner")
          return Response.json(null);
        if (table === options.error)
          return Response.json(
            { message: "database failure" },
            { status: 500 }
          );
        if (table === options.missing) return Response.json(null);
        if (table === "external_agent_runs")
          return Response.json(
            options.list
              ? [run]
              : parsed.searchParams.get("id") === "eq.run"
                ? run
                : null
          );
        if (table === "repos")
          return Response.json(
            parsed.searchParams.get("id") === "eq.repo"
              ? { id: "repo", full_name: "acme/app", user_id: "owner" }
              : null
          );
        if (table === "ai_calls")
          return Response.json(
            parsed.searchParams.get("id") === "eq.call"
              ? {
                  id: "call",
                  status: "streaming",
                  model: "test-model",
                  total_tokens: 120,
                  input_tokens: 100,
                  output_tokens: 20,
                  cost_usd: 0.02,
                  duration_ms: 1000,
                  tool_calls_count: 2,
                }
              : null
          );
        if (table === "ai_call_events")
          return Response.json(
            parsed.searchParams.get("ai_call_id") === "eq.call" ? [event] : []
          );
        throw new Error("Unexpected table");
      },
    },
  });
  return { client, urls, event };
}

it("loads the owned run, repository, usage and ordered recorded report", async () => {
  const { client, urls, event } = fixture();
  const detail = await loadAgentRunDetail("owner", "run", client);
  expect(detail).toMatchObject({
    id: "run",
    source_kind: "agent_run",
    status: "running",
    repo: { id: "repo", full_name: "acme/app" },
    input_tokens: 100,
    output_tokens: 20,
    cost_usd: 0.02,
    duration_ms: 1000,
    latest_ai_call: { id: "call", model: "test-model", total_tokens: 120 },
    dispatch_events: [],
    review_findings: [],
    ai_calls: [{ id: "call", events: [event] }],
  });
  expect(urls.at(-1)?.searchParams.get("order")).toBe("created_at.asc");
});

it("returns no detail for an inaccessible run and does not load related data", async () => {
  const { client, urls } = fixture({ missing: "external_agent_runs" });
  expect(await loadAgentRunDetail("owner", "run", client)).toBeNull();
  expect(urls).toHaveLength(1);
});

it("preserves the run when optional repository or call history is unavailable", async () => {
  const noRepo = fixture({ missing: "repos" });
  expect(await loadAgentRunDetail("owner", "run", noRepo.client)).toMatchObject(
    { repo: { id: "repo", full_name: null } }
  );
  const noCall = fixture({ missing: "ai_calls" });
  expect(await loadAgentRunDetail("owner", "run", noCall.client)).toMatchObject(
    { ai_calls: [], latest_ai_call: null }
  );
  expect(
    noCall.urls.some((url) => url.pathname.endsWith("ai_call_events"))
  ).toBe(false);
  const noEvents = fixture({ missing: "ai_call_events" });
  expect(
    await loadAgentRunDetail("owner", "run", noEvents.client)
  ).toMatchObject({ ai_calls: [{ id: "call", events: [] }] });
});

it.each([
  ["external_agent_runs", "Failed to load agent run"],
  ["repos", "Failed to load run context"],
  ["ai_calls", "Failed to load run context"],
  ["ai_call_events", "Failed to load run activity"],
])("does not turn a %s lookup failure into success", async (error, message) => {
  const { client } = fixture({ error });
  await expect(loadAgentRunDetail("owner", "run", client)).rejects.toThrow(
    message
  );
});

it("queries active work including input requests with owner, date and stable ordering", async () => {
  const { client, urls } = fixture({ list: true });
  const rows = await loadAgentRunRowsFromDb(
    {
      userId: "owner",
      status: "streaming",
      from: "2026-09-01",
      to: "2026-09-06",
    },
    client
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe("run");
  const query = urls[0].searchParams;
  expect(query.get("status")).toBe("in.(streaming,awaiting_input)");
  expect(query.getAll("created_at")).toEqual([
    "gte.2026-09-01",
    "lte.2026-09-06",
  ]);
  expect(query.get("order")).toBe("created_at.desc,id.desc");
  const completed = fixture({ list: true });
  await loadAgentRunRowsFromDb(
    { userId: "owner", status: "success", from: undefined, to: undefined },
    completed.client
  );
  expect(completed.urls[0].searchParams.get("status")).toBe("eq.success");
  expect(completed.urls[0].searchParams.has("created_at")).toBe(false);
});

it("returns an empty list for no rows and rejects database failures", async () => {
  const missing = fixture({ missing: "external_agent_runs" });
  expect(
    await loadAgentRunRowsFromDb(
      { userId: "owner", status: null, from: undefined, to: undefined },
      missing.client
    )
  ).toEqual([]);
  const failed = fixture({ error: "external_agent_runs" });
  await expect(
    loadAgentRunRowsFromDb(
      { userId: "owner", status: null, from: undefined, to: undefined },
      failed.client
    )
  ).rejects.toThrow("Failed to load agent runs");
});
