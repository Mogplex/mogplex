import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

let postSlackResponse: typeof import("./interactivity").postSlackResponse;
let handleSlackBlockActions: typeof import("./interactivity").handleSlackBlockActions;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ postSlackResponse, handleSlackBlockActions } =
    await import("./interactivity"));
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

describe("Slack command action routing", () => {
  const payload = {
    type: "block_actions",
    team: { id: "T1" },
    user: { id: "U1" },
    channel: { id: "C1" },
    response_url: "https://hooks.slack.test/response",
    trigger_id: "trigger-1",
  };

  it("dispatches command and repository picker selections", async () => {
    const dispatchCommand = vi.fn(async () => undefined);
    await expect(
      handleSlackBlockActions(
        {
          ...payload,
          actions: [
            {
              action_id: "mogplex_select_repo",
              selected_option: { value: "repo-1" },
            },
          ],
        },
        { dispatchCommand }
      )
    ).resolves.toEqual({
      outcome: "command_dispatched",
      command: "repo repo-1",
    });
    expect(dispatchCommand).toHaveBeenCalledWith({
      command: "/mogplex",
      text: "repo repo-1",
      teamId: "T1",
      channelId: "C1",
      slackUserId: "U1",
      responseUrl: "https://hooks.slack.test/response",
      triggerId: "trigger-1",
    });
  });

  it("dispatches the harness command from the hub picker", async () => {
    const dispatchCommand = vi.fn(async () => undefined);
    await expect(
      handleSlackBlockActions(
        {
          ...payload,
          actions: [
            {
              action_id: "mogplex_select_command",
              selected_option: { value: "harness" },
            },
          ],
        },
        { dispatchCommand }
      )
    ).resolves.toEqual({ outcome: "command_dispatched", command: "harness" });
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/mogplex",
        text: "harness",
        teamId: "T1",
        channelId: "C1",
        slackUserId: "U1",
      })
    );
  });

  it("routes confirmed PR merges through the protected action handler", async () => {
    const mergePullRequest = vi.fn(async () => ({
      outcome: "pull_request_queued" as const,
      number: 17,
    }));
    const rawValue = JSON.stringify({ number: 17 });
    await expect(
      handleSlackBlockActions(
        {
          ...payload,
          actions: [
            {
              action_id: "mogplex_merge_pr",
              value: rawValue,
            },
          ],
        },
        { mergePullRequest }
      )
    ).resolves.toEqual({ outcome: "pull_request_queued", number: 17 });
    expect(mergePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ team: { id: "T1" } }),
      rawValue
    );
  });
});
