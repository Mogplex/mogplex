import assert from "node:assert/strict";
import test from "node:test";
import { listGithubOrgMembersWithEmails } from "../../lib/github/org-members";
import { GithubHttpError } from "../../lib/github-app";

type FetcherCall = { token: string; url: string };

function buildDeps(responder: (url: string) => unknown): {
  deps: Parameters<typeof listGithubOrgMembersWithEmails>[2];
  calls: FetcherCall[];
} {
  const calls: FetcherCall[] = [];
  return {
    deps: {
      createInstallationAccessToken: async () => ({ token: "tkn" }),
      installationFetch: async <T>(token: string, url: string): Promise<T> => {
        calls.push({ token, url });
        const body = responder(url);
        if (body instanceof Error) throw body;
        return body as T;
      },
    },
    calls,
  };
}

test("listGithubOrgMembersWithEmails paginates members and looks up email per user", async () => {
  const responder = (url: string): unknown => {
    if (url.includes("/orgs/acme/members")) {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page"));
      if (page === 1) {
        return Array.from({ length: 100 }, (_, i) => ({
          login: `member${i + 1}`,
        }));
      }
      if (page === 2) {
        return [{ login: "member101" }, { login: "member102" }];
      }
      return [];
    }
    if (url.includes("/users/")) {
      const match = /\/users\/(.+)$/.exec(url);
      const login = match ? decodeURIComponent(match[1]) : "";
      const n = Number(login.replace("member", ""));
      if (Number.isFinite(n) && n % 2 === 0) {
        return { login, email: `${login}@example.com` };
      }
      return { login, email: null };
    }
    return null;
  };

  const { deps, calls } = buildDeps(responder);
  const members = await listGithubOrgMembersWithEmails(123, "acme", deps);

  assert.equal(members.length, 102);
  const memberPageCalls = calls.filter((c) =>
    c.url.includes("/orgs/acme/members")
  );
  assert.equal(memberPageCalls.length, 2);
  const userLookups = calls.filter((c) => c.url.includes("/users/"));
  assert.equal(userLookups.length, 102);

  const withEmail = members.filter((m) => m.email !== null);
  const withoutEmail = members.filter((m) => m.email === null);
  assert.equal(withEmail.length, 51);
  assert.equal(withoutEmail.length, 51);
});

test("listGithubOrgMembersWithEmails treats a failed user lookup as no public email", async () => {
  const responder = (url: string): unknown => {
    if (url.includes("/orgs/widgets/members")) {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page"));
      if (page === 1) {
        return [{ login: "ok" }, { login: "fails" }];
      }
      return [];
    }
    if (url.endsWith("/users/ok")) {
      return { login: "ok", email: "ok@example.com" };
    }
    if (url.endsWith("/users/fails")) {
      return new Error("GitHub installation request failed (404): {}");
    }
    return null;
  };

  const { deps } = buildDeps(responder);
  const members = await listGithubOrgMembersWithEmails(456, "widgets", deps);
  assert.equal(members.length, 2);
  const byLogin = new Map(members.map((m) => [m.login, m]));
  assert.equal(byLogin.get("ok")?.email, "ok@example.com");
  assert.equal(byLogin.get("fails")?.email, null);
});

test("listGithubOrgMembersWithEmails re-throws a 429 from a user lookup instead of pretending the member has no email", async () => {
  const responder = (url: string): unknown => {
    if (url.includes("/orgs/limited/members")) {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page"));
      if (page === 1) {
        return [{ login: "ok" }, { login: "ratelimited" }];
      }
      return [];
    }
    if (url.endsWith("/users/ok")) {
      return { login: "ok", email: "ok@example.com" };
    }
    if (url.endsWith("/users/ratelimited")) {
      // buildDeps' installationFetch throws when the responder returns an
      // Error instance, so returning a GithubHttpError here surfaces as a
      // thrown 429 in the implementation.
      return new GithubHttpError(429, "rate limited");
    }
    return null;
  };

  const { deps } = buildDeps(responder);
  await assert.rejects(
    () => listGithubOrgMembersWithEmails(456, "limited", deps),
    (err: unknown) => err instanceof GithubHttpError && err.status === 429
  );
});

test("listGithubOrgMembersWithEmails stops paginating early once a short page is returned", async () => {
  const responder = (url: string): unknown => {
    if (url.includes("/orgs/short/members")) {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page"));
      if (page === 1) {
        return [{ login: "alice" }, { login: "bob" }];
      }
      throw new Error("kept paginating past short page");
    }
    if (url.includes("/users/")) {
      return { login: "x", email: null };
    }
    return null;
  };

  const { deps, calls } = buildDeps(responder);
  await listGithubOrgMembersWithEmails(789, "short", deps);
  const memberPageCalls = calls.filter((c) =>
    c.url.includes("/orgs/short/members")
  );
  assert.equal(memberPageCalls.length, 1);
});
