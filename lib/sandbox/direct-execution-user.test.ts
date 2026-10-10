import { describe, expect, it } from "vitest";
import type { ApiKeyAccess } from "@/lib/mogplex-api/key-access";
import {
  assertMayExecuteInTeam,
  getDirectExecutionUser,
  SandboxKeyRestrictedError,
} from "./direct-execution-user";

function resolvedAs(
  source: "better-auth" | "oauth" | "playwright" | "api-key",
  apiKeyAccess?: ApiKeyAccess
) {
  return async () => ({
    profileId: "user-1",
    authUserId: null,
    source,
    ...(apiKeyAccess ? { apiKeyAccess } : {}),
  });
}

describe("getDirectExecutionUser", () => {
  it.each(["better-auth", "oauth", "playwright"] as const)(
    "should accept a %s login without team key policy",
    async (source) => {
      expect(await getDirectExecutionUser(resolvedAs(source))).toEqual({
        userId: "user-1",
        viaApiKey: false,
      });
    }
  );

  it("should accept a full-access key and mark it for team key policy", async () => {
    expect(await getDirectExecutionUser(resolvedAs("api-key", "full"))).toEqual(
      { userId: "user-1", viaApiKey: true }
    );
  });

  it("should refuse an automations-only key with 403 AUTOMATION_REQUIRED", async () => {
    const refusal = getDirectExecutionUser(
      resolvedAs("api-key", "automations")
    );
    await expect(refusal).rejects.toBeInstanceOf(SandboxKeyRestrictedError);
    await expect(refusal).rejects.toMatchObject({
      status: 403,
      code: "AUTOMATION_REQUIRED",
      message: expect.stringMatching(/Settings → Mogplex Keys/),
    });
  });

  it("should refuse a key whose access is unknown", async () => {
    await expect(
      getDirectExecutionUser(resolvedAs("api-key"))
    ).rejects.toBeInstanceOf(SandboxKeyRestrictedError);
  });

  it("should refuse a request with no credentials", async () => {
    expect(await getDirectExecutionUser(async () => undefined)).toBeUndefined();
  });
});

describe("assertMayExecuteInTeam", () => {
  const key = { userId: "user-1", viaApiKey: true };
  const login = { userId: "user-1", viaApiKey: false };
  const holdsKeys = async () => "automations" as const;

  it("should refuse a key in a team that holds keys to automations", async () => {
    await expect(
      assertMayExecuteInTeam(key, "team-1", holdsKeys)
    ).rejects.toMatchObject({
      status: 403,
      code: "AUTOMATION_REQUIRED",
      message: expect.stringMatching(/team owner/),
    });
  });

  it("should allow a key in a team that allows full access", async () => {
    await expect(
      assertMayExecuteInTeam(key, "team-1", async () => "full")
    ).resolves.toBeUndefined();
  });

  it("should allow a key outside a team without a lookup", async () => {
    const lookup = async () => {
      throw new Error("no lookup expected");
    };
    await expect(
      assertMayExecuteInTeam(key, null, lookup)
    ).resolves.toBeUndefined();
  });

  it("should allow an interactive login in any team", async () => {
    await expect(
      assertMayExecuteInTeam(login, "team-1", holdsKeys)
    ).resolves.toBeUndefined();
  });
});
