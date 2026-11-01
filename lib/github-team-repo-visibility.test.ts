import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { filterAuthorizedTeamGithubRepos } from "./github-team-repo-visibility";

const previous = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const rows = [
  { user_id: "a", github_installation_id: 11, github_id: 1 },
  { user_id: "b", github_installation_id: 12, github_id: 2 },
  { user_id: "a", github_installation_id: 11, github_id: 3 },
  { user_id: "a", github_installation_id: 12, github_id: 2 },
  { user_id: "b", github_installation_id: null, github_id: 4 },
  { user_id: "unapproved", github_installation_id: 11, github_id: 1 },
];
beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_NAME", "fixture");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", key);
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: () => {
      const query = {
        select: () => query,
        eq: async (column: string, user: string) => {
          expect(column).toBe("user_id");
          return {
            data:
              user === "unapproved"
                ? []
                : [
                    {
                      installation_id: user === "a" ? 11 : 12,
                      account_login: `approved-${user}`,
                      account_type: "Organization",
                    },
                  ],
            error: null,
          };
        },
      };
      return query;
    },
  });
});
afterEach(() => {
  if (previous) Object.defineProperty(supabaseAdmin, "from", previous);
  else Reflect.deleteProperty(supabaseAdmin, "from");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("keeps only shared rows backed by that row owner's current installation grant", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    requests.push(path);
    const installation = path.match(
      /^\/app\/installations\/(11|12)\/access_tokens$/
    )?.[1];
    if (installation) return Response.json({ token: `ghs-${installation}` });
    if (path === "/installation/repositories") {
      const first =
        new Headers(init?.headers).get("Authorization") === "Bearer ghs-11";
      return Response.json({ repositories: [{ id: first ? 1 : 2 }] });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  expect(await filterAuthorizedTeamGithubRepos(rows)).toEqual(rows.slice(0, 2));
  expect(requests).toHaveLength(4);
  expect(requests).not.toContain("/user/repos");
});
it("does not manufacture team access when App configuration is missing", async () => {
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await filterAuthorizedTeamGithubRepos(rows)).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it("fails closed when GitHub cannot verify a shared installation during an outage", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
  await expect(filterAuthorizedTeamGithubRepos(rows)).rejects.toThrow();
});

it("omits a revoked owner's rows without hiding other authorized team repositories", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/app/installations/11/access_tokens")
      return new Response(null, { status: 403 });
    if (path === "/app/installations/12/access_tokens")
      return Response.json({ token: "ghs-12" });
    return Response.json({ repositories: [{ id: 2 }] });
  });
  expect(await filterAuthorizedTeamGithubRepos(rows)).toEqual([rows[1]]);
});

it("reuses verified installation inventories from the current sync request", async () => {
  const request = vi.fn(async () => {
    throw new Error("must not refetch verified inventories");
  });
  vi.stubGlobal("fetch", request);
  expect(
    await filterAuthorizedTeamGithubRepos(
      rows,
      new Map([
        [11, new Set([1])],
        [12, new Set([2])],
      ])
    )
  ).toEqual(rows.slice(0, 2));
  expect(request).not.toHaveBeenCalled();
});
