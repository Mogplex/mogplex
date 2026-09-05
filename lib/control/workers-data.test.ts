import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { loadControlWorkers } from "./workers-data";

function fixture(
  options: { missing?: string; error?: string; noRun?: boolean } = {}
) {
  const urls: URL[] = [];
  const client = createClient("https://database.example.test", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url);
        const table = url.pathname.split("/").at(-1);
        if (url.searchParams.get("user_id") !== "eq.owner")
          return Response.json(null);
        if (table === options.error)
          return Response.json({ message: "database error" }, { status: 500 });
        if (table === options.missing) return Response.json(null);
        if (table === "control_sessions")
          return Response.json(
            url.searchParams.get("id") === "eq.session"
              ? { orchestration_run_id: options.noRun ? null : "mission" }
              : null
          );
        if (table === "orchestration_worktrees")
          return Response.json(
            url.searchParams.get("run_id") === "eq.mission"
              ? [{ id: "tree", branch_name: "fix/tests" }]
              : []
          );
        if (table === "external_agent_runs")
          return Response.json(
            url.searchParams.get("worktree_id") === "eq.tree" &&
              url.searchParams.get("order") === "created_at.desc,id.desc" &&
              url.searchParams.get("limit") === "1"
              ? {
                  id: "latest-worker",
                  ai_call_id: "call",
                  status: "failed",
                  error: "exit 1",
                  updated_at: "2026-09-05",
                }
              : null
          );
        if (table === "ai_call_events")
          return Response.json(
            url.searchParams.get("ai_call_id") === "eq.call"
              ? [
                  {
                    id: "2",
                    event_type: "tool_finished",
                    tool_name: "Command",
                    message: "401 Unauthorized",
                    payload: {
                      toolCallId: "cmd",
                      state: "error",
                      output: "failed",
                      env: { KEY: "private-fixture" },
                    },
                    created_at: "2026-09-05T01:00:01Z",
                  },
                  {
                    id: "1",
                    event_type: "tool_started",
                    tool_name: "Command",
                    message: "Command",
                    payload: {
                      toolCallId: "cmd",
                      input: { command: "pnpm test" },
                    },
                    created_at: "2026-09-05T01:00:00Z",
                  },
                ]
              : []
          );
        throw new Error("Unexpected table");
      },
    },
  });
  return { client, urls };
}

it("loads only the owned mission's latest attempt, ordered output and safe error", async () => {
  const { client, urls } = fixture();
  const workers = await loadControlWorkers("owner", "session", client);
  expect(workers).toHaveLength(1);
  expect(workers?.[0]).toMatchObject({
    id: "latest-worker",
    branch: "fix/tests",
    status: "failed",
    error:
      "Worker could not authenticate. Check its AI connection before retrying.",
    events: [
      { id: "1", payload: { input: { command: "pnpm test" } } },
      { id: "2", payload: { output: "failed" } },
    ],
  });
  expect(JSON.stringify(workers)).not.toContain("private-fixture");
  expect(
    urls.every((url) => url.searchParams.get("user_id") === "eq.owner")
  ).toBe(true);
});

it("does not load other users' missions or nonexistent sessions", async () => {
  for (const [user, session] of [
    ["other", "session"],
    ["owner", "other"],
  ]) {
    const { client, urls } = fixture();
    expect(await loadControlWorkers(user, session, client)).toBeNull();
    expect(urls).toHaveLength(1);
  }
});

it("treats no run, no worktrees and no worker as empty, not a fabricated running worker", async () => {
  for (const options of [
    { noRun: true },
    { missing: "orchestration_worktrees" },
    { missing: "external_agent_runs" },
  ]) {
    expect(
      await loadControlWorkers("owner", "session", fixture(options).client)
    ).toEqual([]);
  }
});

it.each([
  "control_sessions",
  "orchestration_worktrees",
  "external_agent_runs",
  "ai_call_events",
])(
  "surfaces %s read errors instead of claiming an empty successful mission",
  async (error) => {
    await expect(
      loadControlWorkers("owner", "session", fixture({ error }).client)
    ).rejects.toThrow("Could not load");
  }
);
