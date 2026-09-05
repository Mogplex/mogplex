import { afterEach, expect, it, vi } from "vitest";
import {
  readRunGithubEvidence,
  loadRunResultEvidence,
} from "./run-result-evidence";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const input = {
  repoFullName: "acme/app",
  branch: "fix/mobile",
  token: "fixture-token",
};
const sha = "a".repeat(40);
const pr = {
  number: 42,
  state: "open",
  draft: false,
  merged_at: null,
  head: { ref: input.branch, repo: { full_name: input.repoFullName } },
  base: { repo: { full_name: input.repoFullName } },
};

it("confirms artifacts from GitHub for the exact repository and working branch", async () => {
  const evidence = await readRunGithubEvidence(input, async (url, init) => {
    expect(String(url)).toMatch(
      /^https:\/\/api.github.com\/repos\/acme\/app\//
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer fixture-token"
    );
    return Response.json(
      String(url).includes("/branches/") ? { commit: { sha } } : [pr]
    );
  });
  expect(evidence.branch).toEqual({
    sha,
    url: "https://github.com/acme/app/tree/" + sha,
  });
  expect(evidence.pullRequests).toEqual([
    { number: 42, state: "open", url: "https://github.com/acme/app/pull/42" },
  ]);
  expect(evidence.checked).toBe(true);
});

it("does not promote another branch or repository's pull request to an artifact", async () => {
  const evidence = await readRunGithubEvidence(input, async (url) =>
    Response.json(
      String(url).includes("/branches/")
        ? { commit: { sha } }
        : [
            { ...pr, head: { ...pr.head, ref: "other" } },
            { ...pr, head: { ...pr.head, repo: { full_name: "other/app" } } },
          ]
    )
  );
  expect(evidence.pullRequests).toEqual([]);
});

it("treats provider failures and malformed data as unknown, not proof of missing work", async () => {
  for (const response of [
    new Response(null, { status: 403 }),
    Response.json({ commit: { sha: "bad" } }),
  ]) {
    const evidence = await readRunGithubEvidence(input, async () =>
      response.clone()
    );
    expect(evidence.checked).toBe(false);
    expect(evidence.branch).toBeNull();
    expect(evidence.pullRequests).toEqual([]);
  }
});

it("loads workspace and GitHub evidence only through the run owner's records", async () => {
  vi.stubEnv("MOGPLEX_DATA_BACKEND", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://database.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  const queries: URL[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "database.example.test") queries.push(parsed);
      if (parsed.pathname.endsWith("/repos"))
        return Response.json({
          full_name: input.repoFullName,
          user_id: "owner-1",
          github_installation_id: null,
        });
      if (parsed.pathname.endsWith("/sandboxes"))
        return Response.json({
          status: "paused",
          persistent: true,
          snapshot_id: "snapshot-1",
          working_branch: input.branch,
        });
      if (parsed.pathname.endsWith("/get_oauth_token")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          p_user_id: "owner-1",
          p_provider: "github",
        });
        return Response.json("fixture-github-token");
      }
      if (parsed.pathname.includes("/branches/"))
        return Response.json({ commit: { sha } });
      if (
        parsed.hostname === "api.github.com" &&
        parsed.pathname.endsWith("/pulls")
      )
        return Response.json([pr]);
      throw new Error("Unexpected external request");
    }
  );
  const evidence = await loadRunResultEvidence({
    id: "run-1",
    metadata: {},
    user_id: "owner-1",
    repo_id: "repo-1",
    sandbox_record_id: "sandbox-record-1",
    working_branch: input.branch,
  });
  expect(evidence.workspace).toEqual({
    status: "paused",
    persistent: true,
    snapshotRecorded: true,
  });
  expect(evidence.github.pullRequests[0].number).toBe(42);
  const recordQueries = queries.filter(
    (url) => !url.pathname.includes("/rpc/")
  );
  expect(recordQueries).toHaveLength(2);
  expect(
    recordQueries.every(
      (url) => url.searchParams.get("user_id") === "eq.owner-1"
    )
  ).toBe(true);
  expect(
    recordQueries
      .find((url) => url.pathname.endsWith("/sandboxes"))
      ?.searchParams.get("repo_id")
  ).toBe("eq.repo-1");
});
