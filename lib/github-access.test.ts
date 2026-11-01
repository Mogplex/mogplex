import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGithubAccessTokenForRepo } from "./github-access";

const previous = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_NAME", "fixture");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", key);
  const query = {
    select: () => query,
    eq: async () => ({
      data: [
        {
          installation_id: 12,
          account_login: "approved",
          account_type: "Organization",
        },
        {
          installation_id: 13,
          account_login: "another-approved",
          account_type: "Organization",
        },
      ],
      error: null,
    }),
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: () => query,
  });
});
afterEach(() => {
  if (previous) Object.defineProperty(supabaseAdmin, "from", previous);
  else Reflect.deleteProperty(supabaseAdmin, "from");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("does not mint a credential for a repository claiming another user's installation", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    await getGithubAccessTokenForRepo({
      user_id: "owner",
      github_installation_id: 99,
    })
  ).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("preserves an approved installation's scoped repository access", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://api.github.com/app/installations/12/access_tokens"
      );
      return Response.json({
        token: "ghs-fixture",
        expires_at: "2027-01-01T00:00:00Z",
      });
    })
  );
  expect(
    await getGithubAccessTokenForRepo({
      user_id: "owner",
      github_installation_id: 12,
    })
  ).toBe("ghs-fixture");
});

it("returns no credential for a revoked installation and preserves genuine provider errors", async () => {
  for (const status of [401, 403, 404]) {
    vi.stubGlobal("fetch", async () => new Response(null, { status }));
    expect(
      await getGithubAccessTokenForRepo({
        user_id: "owner",
        github_installation_id: 12,
      })
    ).toBeNull();
  }
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
  await expect(
    getGithubAccessTokenForRepo({
      user_id: "owner",
      github_installation_id: 12,
    })
  ).rejects.toThrow();
  vi.stubGlobal("fetch", async () =>
    Response.json({ message: "API rate limit exceeded" }, { status: 403 })
  );
  await expect(
    getGithubAccessTokenForRepo({
      user_id: "owner",
      github_installation_id: 12,
    })
  ).rejects.toThrow(/rate limit/i);
});
