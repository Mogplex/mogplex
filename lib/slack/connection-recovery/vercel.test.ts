import { afterEach, expect, it, vi } from "vitest";
import { loadSlackVercelProjects, SlackVercelAccessError } from "./vercel";

afterEach(() => vi.unstubAllGlobals());
const token = async () => "user-vercel-token";

it("does not claim an empty project list on a malformed provider response", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ unexpected: true }));
  await expect(
    loadSlackVercelProjects("user", undefined, token)
  ).rejects.toMatchObject({ needsAuthorization: false });
});

it("finds the exact team across pages and reads linked GitHub repos with only the user's token", async () => {
  const urls: URL[] = [];
  vi.stubGlobal("fetch", async (input: URL, init: RequestInit) => {
    const url = new URL(input);
    urls.push(new URL(url));
    expect(init.headers).toEqual({ Authorization: "Bearer user-vercel-token" });
    expect(url.origin).toBe("https://api.vercel.com");
    if (url.pathname === "/v2/teams")
      return Response.json(
        url.searchParams.has("until")
          ? { teams: [{ id: "team_2", slug: "acme" }] }
          : {
              teams: [{ id: "team_1", slug: "another" }],
              pagination: { next: 123 },
            }
      );
    expect(url.searchParams.get("teamId")).toBe("team_2");
    return Response.json(
      url.searchParams.has("until")
        ? { projects: [{ id: "p2", name: "other", link: { type: "gitlab" } }] }
        : {
            projects: [
              {
                id: "p1",
                name: "widgets",
                framework: "nextjs",
                link: { type: "github", org: "alex", repo: "widgets" },
              },
            ],
            pagination: { next: 456 },
          }
    );
  });
  expect(await loadSlackVercelProjects("user", "ACME", token)).toEqual([
    {
      id: "p1",
      name: "widgets",
      repository: "alex/widgets",
      framework: "nextjs",
    },
    { id: "p2", name: "other", repository: null, framework: null },
  ]);
  expect(urls).toHaveLength(4);
});
it("does not substitute platform credentials when the user has no token", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    loadSlackVercelProjects("user", "acme", async () => null)
  ).rejects.toMatchObject({ needsAuthorization: true });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([401, 403, 404, 429, 500])(
  "distinguishes authorization failure from provider outage (%s)",
  async (status) => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "private provider details" }, { status })
    );
    await expect(
      loadSlackVercelProjects("user", "personal", token)
    ).rejects.toMatchObject({
      needsAuthorization: [401, 403, 404].includes(status),
    });
  }
);
it("asks for the requested team instead of silently searching another one", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      teams: [{ id: "team_1", slug: "another" }],
      pagination: { next: 1 },
    })
  );
  await expect(
    loadSlackVercelProjects("user", "acme", token)
  ).rejects.toBeInstanceOf(SlackVercelAccessError);
});
it("supports personal projects without requiring a team and stops repeated cursors", async () => {
  const fetch = vi.fn(async (url: URL) => {
    expect(url.searchParams.has("teamId")).toBe(false);
    return Response.json({ projects: [], pagination: { next: 123 } });
  });
  vi.stubGlobal("fetch", fetch);
  expect(await loadSlackVercelProjects("user", undefined, token)).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
