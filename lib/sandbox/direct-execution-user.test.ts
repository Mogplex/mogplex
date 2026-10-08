import { describe, expect, it } from "vitest";
import type { ApiKeyAccess } from "@/lib/mogplex-api/key-access";
import {
  getDirectExecutionUser,
  mayExecuteInTeam,
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

  it("should refuse an automations-only key", async () => {
    expect(
      await getDirectExecutionUser(resolvedAs("api-key", "automations"))
    ).toBeUndefined();
  });

  it("should refuse a key whose access is unknown", async () => {
    expect(await getDirectExecutionUser(resolvedAs("api-key"))).toBeUndefined();
  });

  it("should refuse a request with no credentials", async () => {
    expect(await getDirectExecutionUser(async () => undefined)).toBeUndefined();
  });
});

describe("mayExecuteInTeam", () => {
  const key = { userId: "user-1", viaApiKey: true };
  const login = { userId: "user-1", viaApiKey: false };
  const holdsKeys = async () => "automations" as const;

  it("should refuse a key in a team that holds keys to automations", async () => {
    expect(await mayExecuteInTeam(key, "team-1", holdsKeys)).toBe(false);
  });

  it("should allow a key in a team that allows full access", async () => {
    expect(await mayExecuteInTeam(key, "team-1", async () => "full")).toBe(
      true
    );
  });

  it("should allow a key outside a team without a lookup", async () => {
    const lookup = async () => {
      throw new Error("no lookup expected");
    };
    expect(await mayExecuteInTeam(key, null, lookup)).toBe(true);
  });

  it("should allow an interactive login in any team", async () => {
    expect(await mayExecuteInTeam(login, "team-1", holdsKeys)).toBe(true);
  });
});
