import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

let postSlackResponse: typeof import("./interactivity").postSlackResponse;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ postSlackResponse } = await import("./interactivity"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Slack response posting", () => {
  it("posts JSON to Slack's response host", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await postSlackResponse("https://hooks.slack.com/actions/response", {
      text: "Updated",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/response",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Updated" }),
      }
    );
  });

  it("rejects an unexpected response host before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postSlackResponse("https://example.com/response", { text: "Updated" })
    ).rejects.toThrow("unexpected host");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
