import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reconcileGithubInstallationsForUser } from "./github-installations";

const previous = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
let count = 0;
let error: { message: string } | null = null;
beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_NAME", "fixture");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
  count = 0;
  error = null;
  const query = {
    select: () => query,
    eq: async (column: string, userId: string) => {
      expect(column).toBe("user_id");
      expect(userId).toBe("fixture-user");
      return { count, error };
    },
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
it("reports only existing attachments without App-wide discovery or new grants", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  expect(
    await reconcileGithubInstallationsForUser(
      "fixture-user",
      "member",
      "legacy-fixture"
    )
  ).toEqual({ discovered: 0 });
  count = 2;
  expect(await reconcileGithubInstallationsForUser("fixture-user")).toEqual({
    discovered: 2,
  });
  expect(request).not.toHaveBeenCalled();
});
it("does not guess grants after a failed database lookup", async () => {
  error = { message: "unavailable" };
  await expect(
    reconcileGithubInstallationsForUser("fixture-user")
  ).rejects.toThrow("existing GitHub installations");
});
it("does not discover App installations in an OAuth-only deployment", async () => {
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
  count = 2;
  expect(await reconcileGithubInstallationsForUser("fixture-user")).toEqual({
    discovered: 0,
  });
});
