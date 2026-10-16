import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let openSlackView: typeof import("./client").openSlackView;
let unfurlSlackLinks: typeof import("./client").unfurlSlackLinks;
let presentSlackEntityDetails: typeof import("./client").presentSlackEntityDetails;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ openSlackView, unfurlSlackLinks, presentSlackEntityDetails } =
    await import("./client"));
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

describe("Slack Work Objects", () => {
  const okFetch = () =>
    vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }))
    );

  it("should unfurl with Work Object metadata only", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const metadata = { entities: [{ entity_type: "slack#/entities/task" }] };

    await unfurlSlackLinks("xoxb-test", {
      unfurl_id: "u1",
      source: "composer",
      metadata,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://slack.com/api/chat.unfurl");
    expect(JSON.parse(String(init?.body))).toEqual({
      unfurl_id: "u1",
      source: "composer",
      metadata,
    });
  });

  it("should send flexpane details and surface Slack errors", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await presentSlackEntityDetails("xoxb-test", {
      trigger_id: "t1",
      error: { status: "restricted" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://slack.com/api/entity.presentDetails"
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "expired_trigger" }))
      )
    );
    await expect(
      presentSlackEntityDetails("xoxb-test", { trigger_id: "t1", metadata: {} })
    ).rejects.toThrow("expired_trigger");
  });
});
