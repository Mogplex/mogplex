import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getGithubOAuthRepositoryToken,
  isGithubOAuthRepositoryAccessAllowed,
} from "./github-repository-auth";

const previous = ["from", "rpc"].map(
  (name) =>
    [name, Object.getOwnPropertyDescriptor(supabaseAdmin, name)] as const
);
let profile: { github_auth_mode: string | null } | null;
let queryError: { message: string } | null;
let vaultReads = 0;

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "");
  vi.stubEnv("GITHUB_APP_NAME", "");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
  profile = { github_auth_mode: "oauth" };
  queryError = null;
  vaultReads = 0;
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: profile, error: queryError }),
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: () => query,
  });
  Object.defineProperty(supabaseAdmin, "rpc", {
    configurable: true,
    value: async () => {
      vaultReads++;
      return { data: "legacy-oauth-token", error: null };
    },
  });
});
afterEach(() => {
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(supabaseAdmin, name, descriptor);
    else Reflect.deleteProperty(supabaseAdmin, name);
  }
  vi.unstubAllEnvs();
});

it("keeps broad OAuth credentials out of an App deployment even for a legacy OAuth profile", async () => {
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_APP_NAME", "mogplex-test");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
  expect(await getGithubOAuthRepositoryToken("user")).toBeNull();
  expect(vaultReads).toBe(0);
});
it("fails closed for App-mode, missing, and unrecognized profiles when App configuration is absent", async () => {
  for (const value of [
    { github_auth_mode: "app" },
    null,
    { github_auth_mode: "unknown" },
  ]) {
    profile = value;
    expect(await getGithubOAuthRepositoryToken("user")).toBeNull();
  }
  expect(vaultReads).toBe(0);
});
it("retains explicitly configured OAuth-only deployments and their legacy profiles", async () => {
  expect(await getGithubOAuthRepositoryToken("user")).toBe(
    "legacy-oauth-token"
  );
  profile = { github_auth_mode: null };
  expect(await isGithubOAuthRepositoryAccessAllowed("user")).toBe(true);
  expect(vaultReads).toBe(1);
});
it("does not release a credential after a failed authorization lookup", async () => {
  queryError = { message: "provider unavailable" };
  await expect(getGithubOAuthRepositoryToken("user")).rejects.toThrow(
    "Could not verify GitHub repository authorization"
  );
  expect(vaultReads).toBe(0);
});
