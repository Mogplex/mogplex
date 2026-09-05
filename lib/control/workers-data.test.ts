import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { loadControlWorkers } from "./workers-data";

function fixture(
  options: { missing?: boolean; error?: boolean; empty?: boolean } = {}
) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = createClient("https://database.example.test", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url: String(input), body });
        if (options.error)
          return Response.json(
            { message: "private database error" },
            { status: 500 }
          );
        if (
          options.missing ||
          body.p_user_id !== "owner" ||
          body.p_session_id !== "session"
        )
          return Response.json(null);
        if (options.empty) return Response.json([]);
        return Response.json([
          {
            id: "latest-worker",
            worktree_id: "tree",
            branch: "fix/tests",
            status: "failed",
            error: "exit 1",
            updated_at: "2026-09-05",
            events: body.p_include_events
              ? [
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
                ]
              : [],
          },
        ]);
      },
    },
  });
  return { client, requests };
}

it("loads an owned mission snapshot with one database request and sanitized activity", async () => {
  const { client, requests } = fixture();
  const workers = await loadControlWorkers("owner", "session", client);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    url: "https://database.example.test/rest/v1/rpc/control_mission_workers",
    body: {
      p_user_id: "owner",
      p_session_id: "session",
      p_include_events: true,
    },
  });
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
});

it("keeps status-only reads free of activity queries and payloads", async () => {
  const { client, requests } = fixture();
  expect(
    await loadControlWorkers("owner", "session", client, {
      includeEvents: false,
    })
  ).toMatchObject([{ status: "failed", events: [] }]);
  expect(requests).toHaveLength(1);
  expect(requests[0].body.p_include_events).toBe(false);
});

it("does not turn inaccessible sessions or empty missions into fabricated running workers", async () => {
  expect(
    await loadControlWorkers("other", "session", fixture().client)
  ).toBeNull();
  expect(
    await loadControlWorkers("owner", "other", fixture().client)
  ).toBeNull();
  expect(
    await loadControlWorkers(
      "owner",
      "session",
      fixture({ missing: true }).client
    )
  ).toBeNull();
  expect(
    await loadControlWorkers(
      "owner",
      "session",
      fixture({ empty: true }).client
    )
  ).toEqual([]);
});

it("surfaces database failures instead of claiming successful empty work", async () => {
  await expect(
    loadControlWorkers("owner", "session", fixture({ error: true }).client)
  ).rejects.toThrow("Could not load mission workers");
});
