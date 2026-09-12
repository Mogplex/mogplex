import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { loadSlackThreadRunContext } from "./thread-run-context";

const thread = {
  userId: "owner",
  teamId: "T1",
  channelId: "D1",
  threadTs: "1.2",
  slackUserId: "U1",
};
function fixture(runCount = 1, unavailable = false) {
  const urls: URL[] = [];
  const client = createClient("https://database.example.test", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url) => {
        const parsed = new URL(String(url));
        urls.push(parsed);
        if (unavailable) return new Response(null, { status: 503 });
        return Response.json(
          parsed.pathname.endsWith("external_agent_runs")
            ? Array.from({ length: runCount }, (_, i) => ({
                id: `run-${i}`,
                ai_call_id: "call",
                status: "failed",
                error: "Mogplex run stopped: tool-calls",
                working_branch: "work",
                metadata: { secret: "must-not-leak" },
              }))
            : [
                {
                  event_type: "tool_finished",
                  message: "test recovered",
                  payload: { output: { exitCode: 0, token: "must-not-leak" } },
                },
              ]
        );
      },
    },
  });
  return { client, urls };
}
it("loads a terminal run only from the owned exact thread and pins events to its call", async () => {
  const f = fixture();
  const context = await loadSlackThreadRunContext(thread, f.client);
  expect(context).toContain("Mogplex run stopped: tool-calls");
  expect(context).toContain("test recovered");
  expect(context).not.toContain("must-not-leak");
  expect(
    f.urls.every((url) => url.searchParams.get("user_id") === "eq.owner")
  ).toBe(true);
  for (const url of f.urls.slice(0, 2)) {
    expect(url.searchParams.get("metadata->>slack_user_id")).toBe("eq.U1");
    expect(url.searchParams.has("status")).toBe(false);
    expect(url.searchParams.get("metadata")).toContain(
      '"teamId":"T1","channelId":"D1"'
    );
  }
  expect(f.urls[0].searchParams.get("metadata->>slack_thread_ts")).toBe(
    "eq.1.2"
  );
  expect(f.urls[1].searchParams.get("metadata")).toContain('"messageTs":"1.2"');
  expect(f.urls[2].searchParams.get("ai_call_id")).toBe("eq.call");
});
it("does not guess a run when there is no match or several matches", async () => {
  expect(await loadSlackThreadRunContext(thread, fixture(0).client)).toBeNull();
  const f = fixture(2);
  expect(await loadSlackThreadRunContext(thread, f.client)).toContain(
    "Ask which run"
  );
  expect(f.urls).toHaveLength(2);
});
it("distinguishes unavailable run records from an empty lookup", async () => {
  expect(
    await loadSlackThreadRunContext(thread, fixture(0, true).client)
  ).toContain("temporarily unavailable");
});
