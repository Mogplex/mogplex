import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let openSlackView: typeof import("./client").openSlackView;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ openSlackView } = await import("./client"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Slack views", () => {
  it("opens a modal with the workspace bot token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, view: { id: "V1" } }), {
          status: 200,
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = { type: "modal", callback_id: "callback" };

    await expect(
      openSlackView("xoxb-test", { trigger_id: "trigger-1", view })
    ).resolves.toEqual({ ok: true, view: { id: "V1" } });
    expect(fetchMock).toHaveBeenCalledWith("https://slack.com/api/views.open", {
      method: "POST",
      headers: {
        authorization: "Bearer xoxb-test",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ trigger_id: "trigger-1", view }),
    });
  });
});
