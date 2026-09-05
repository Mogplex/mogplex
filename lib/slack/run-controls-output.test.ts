import { afterEach, expect, it, vi } from "vitest";
import { loadRunOutput } from "./run-controls-notify";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const run = {
  id: "run-1",
  user_id: "owner-1",
  ai_call_id: "call-1",
  metadata: {},
};

function transport(responses: Array<unknown | Response>) {
  vi.stubEnv("MOGPLEX_DATA_BACKEND", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://database.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  const queries: URL[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/rest/v1/ai_call_events");
    expect(parsed.searchParams.get("user_id")).toBe("eq.owner-1");
    expect(parsed.searchParams.get("ai_call_id")).toBe("eq.call-1");
    expect(parsed.searchParams.get("event_type")).toBe("eq.log");
    queries.push(parsed);
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected extra query");
    return response instanceof Response
      ? response.clone()
      : Response.json(response);
  });
  return queries;
}

it("prefers the complete final response rather than joining activity chunks", async () => {
  const queries = transport([
    { message: "Final report begins here. The task is complete." },
  ]);
  expect(await loadRunOutput(run)).toBe(
    "Final report begins here. The task is complete."
  );
  expect(queries).toHaveLength(1);
  expect(queries[0].searchParams.get("payload->>kind")).toBe(
    "eq.assistant_final"
  );
  expect(queries[0].searchParams.get("limit")).toBe("1");
});

it("retains chronological telemetry fallback for older or interrupted runs", async () => {
  const queries = transport([
    null,
    [{ message: "Last update." }, { message: "First update. " }],
  ]);
  expect(await loadRunOutput(run)).toBe("First update. Last update.");
  expect(queries[1].searchParams.get("payload->>kind")).toBe(
    "eq.assistant_delta"
  );
  expect(queries[1].searchParams.get("order")).toBe("created_at.desc,id.desc");
});

it("fails closed on a final-report query failure and skips missing ownership", async () => {
  const queries = transport([
    Response.json({ message: "Unavailable" }, { status: 403 }),
  ]);
  await expect(loadRunOutput(run)).rejects.toThrow(
    "Failed to load final run report"
  );
  expect(queries).toHaveLength(1);
  expect(await loadRunOutput({ ...run, user_id: null })).toBeNull();
  expect(queries).toHaveLength(1);
});
