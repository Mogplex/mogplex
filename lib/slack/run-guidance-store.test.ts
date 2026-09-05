import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import {
  findSlackGuidanceRuns,
  submitSlackRunGuidance,
  loadRunGuidance,
  deliverRunGuidance,
} from "./run-guidance-store";

const owner = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const callId = "00000000-0000-4000-8000-000000000003";
const id = "00000000-0000-4000-8000-000000000004";
const thread = {
  userId: owner,
  teamId: "T1",
  channelId: "C1",
  threadTs: "1.2",
  slackUserId: "U1",
  eventId: "Ev1",
};
const run = { id: runId, user_id: owner, ai_call_id: callId };
const row = {
  ...run,
  id,
  run_id: runId,
  body: "Keep desktop unchanged",
  attachments: null,
  status: "received",
  delivered_step: null,
  created_at: new Date(0).toISOString(),
};
function fixture(
  respond: (url: URL, body: Record<string, unknown>) => Response
) {
  const calls: URL[] = [];
  const client = createClient("https://database.example.test", "fixture", {
    global: {
      fetch: async (url, init) => {
        const parsed = new URL(String(url));
        calls.push(parsed);
        return respond(parsed, init?.body ? JSON.parse(String(init.body)) : {});
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, calls };
}

it("pins an existing webhook receipt to its owned run without an active-status filter", async () => {
  const f = fixture((url) =>
    Response.json(
      url.pathname.endsWith("slack_run_guidance")
        ? { run_id: runId }
        : { ...run, status: "failed" }
    )
  );
  const found = await findSlackGuidanceRuns(thread, f.client);
  expect(found[0].status).toBe("failed");
  expect(
    f.calls.every((url) => url.searchParams.get("user_id") === `eq.${owner}`)
  ).toBe(true);
  expect(f.calls[0].searchParams.get("slack_user_id")).toBe("eq.U1");
  expect(f.calls[0].searchParams.get("event_id")).toBe("eq.Ev1");
  expect(f.calls[1].searchParams.has("status")).toBe(false);
});

it("deduplicates exact-thread lookup results while retaining ambiguity", async () => {
  const f = fixture((url) =>
    Response.json(
      url.pathname.endsWith("slack_run_guidance")
        ? null
        : [run, { ...run, id: callId }]
    )
  );
  expect(
    (await findSlackGuidanceRuns(thread, f.client)).map((r) => r.id)
  ).toEqual([runId, callId]);
  expect(
    f.calls
      .slice(1)
      .every(
        (url) =>
          url.searchParams.get("status") ===
          "in.(pending,streaming,awaiting_input)"
      )
  ).toBe(true);
});

it("fails closed for unavailable receipts, missing pinned runs and unavailable thread lookups", async () => {
  for (const response of [
    (url: URL) =>
      url.pathname.endsWith("slack_run_guidance")
        ? new Response(null, { status: 403 })
        : Response.json(null),
    (url: URL) =>
      Response.json(
        url.pathname.endsWith("slack_run_guidance") ? { run_id: runId } : null
      ),
    (url: URL) =>
      url.pathname.endsWith("slack_run_guidance")
        ? Response.json(null)
        : new Response(null, { status: 403 }),
  ])
    await expect(
      findSlackGuidanceRuns(thread, fixture(response).client)
    ).rejects.toThrow();
});

it("saves and consumes typed receipts at the provider boundary without widening the owner or segment", async () => {
  const f = fixture((url, body) => {
    if (url.pathname.endsWith("submit_slack_run_guidance")) {
      expect(body).toMatchObject({
        p_user_id: owner,
        p_run_id: runId,
        p_ai_call_id: callId,
        p_event_id: "Ev1",
      });
      return Response.json({ id, status: "received" });
    }
    if (url.pathname.endsWith("deliver_slack_run_guidance")) {
      expect(body).toMatchObject({ p_guidance_ids: [id], p_step: 2 });
      return Response.json(1);
    }
    expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    expect(url.searchParams.get("ai_call_id")).toBe(`eq.${callId}`);
    return Response.json([row]);
  });
  expect(
    await submitSlackRunGuidance(
      {
        ...thread,
        runId,
        aiCallId: callId,
        messageTs: "1.3",
        body: row.body,
        attachments: null,
      },
      f.client
    )
  ).toEqual({ id, status: "received" });
  expect((await loadRunGuidance(run, f.client))[0].body).toBe(row.body);
  expect(
    await deliverRunGuidance(
      { runId, userId: owner, aiCallId: callId, ids: [id], step: 2 },
      f.client
    )
  ).toBe(1);
  expect(
    await deliverRunGuidance(
      { runId, userId: owner, aiCallId: callId, ids: [], step: 2 },
      f.client
    )
  ).toBe(0);
});

it("propagates failed saves, reads and step receipts instead of claiming delivery", async () => {
  const f = fixture(() => new Response(null, { status: 403 }));
  await expect(
    submitSlackRunGuidance(
      {
        ...thread,
        runId,
        aiCallId: callId,
        messageTs: "1.3",
        body: row.body,
        attachments: null,
      },
      f.client
    )
  ).rejects.toThrow();
  await expect(loadRunGuidance(run, f.client)).rejects.toThrow();
  await expect(
    deliverRunGuidance(
      { runId, userId: owner, aiCallId: callId, ids: [id], step: 2 },
      f.client
    )
  ).rejects.toThrow();
});
