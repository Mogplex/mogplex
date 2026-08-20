import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubPullRequestUpdateTool } from "./github-api";

type PullRequestUpdateTool = {
  inputSchema: {
    safeParse: (input: unknown) => { success: boolean };
  };
  execute: (input: {
    number: number;
    title?: string;
    body?: string;
  }) => Promise<unknown>;
};

function createUpdateTool(token: string | null = "github-token") {
  return createGithubPullRequestUpdateTool(token, {
    owner: "acme",
    repo: "demo",
  }) as unknown as PullRequestUpdateTool;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("github_update_pull_request", () => {
  it("updates pull request metadata in the active repository", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      Response.json({
        number: 42,
        html_url: "https://github.com/acme/demo/pull/42",
        title: "Keep Slack users informed",
        body: "Includes regression coverage.",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createUpdateTool().execute({
        number: 42,
        body: "Includes regression coverage.",
      })
    ).resolves.toEqual({
      ok: true,
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/acme/demo/pull/42",
      title: "Keep Slack users informed",
      body: "Includes regression coverage.",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.github.com/repos/acme/demo/pulls/42");
    expect(init).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ body: "Includes regression coverage." }),
    });
  });

  it("validates updates and rejects missing GitHub access", async () => {
    const configured = createUpdateTool();
    expect(configured.inputSchema.safeParse({ number: 42 }).success).toBe(
      false
    );
    expect(
      configured.inputSchema.safeParse({ number: 42, body: "" }).success
    ).toBe(true);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createUpdateTool(null).execute({ number: 42, title: "Updated title" })
    ).resolves.toEqual({
      error:
        "GitHub access is not configured for this workspace. Connect the Mogplex GitHub App in Settings to enable GitHub queries.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a useful error when GitHub rejects the update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ message: "Resource not accessible" }, { status: 403 })
      )
    );

    await expect(
      createUpdateTool().execute({ number: 42, title: "Updated title" })
    ).resolves.toEqual({ error: "Resource not accessible" });
  });
});
