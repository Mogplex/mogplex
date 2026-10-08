import { describe, expect, it } from "vitest";
import type { ApiKeyAccess } from "./credential-boundary";
import {
  requireKeyAllowedOn,
  resolveAutomationOnly,
  type LoadTeamKeyAccess,
  type TeamKeyAccessTarget,
} from "./team-key-access";

const login = {
  userId: "user-1",
  credentialKind: "interactive",
  keyAccess: null,
} as const;
const fullKey = {
  userId: "user-1",
  credentialKind: "integration",
  keyAccess: "full",
} as const;
const automationsKey = { ...fullKey, keyAccess: "automations" } as const;

function teamAccess(access: ApiKeyAccess | null) {
  const seen: TeamKeyAccessTarget[] = [];
  const load: LoadTeamKeyAccess = async (_userId, target) => {
    seen.push(target);
    return access;
  };
  return { load, seen };
}

const failingLoad: LoadTeamKeyAccess = async () => {
  throw new Error("database unavailable");
};

describe("requireKeyAllowedOn", () => {
  it("should let an interactive login act without a team lookup", async () => {
    const { load, seen } = teamAccess("automations");
    expect(await requireKeyAllowedOn(login, { repoId: "r1" }, load)).toBeNull();
    expect(seen).toEqual([]);
  });

  it("should refuse an automations-only key without a team lookup", async () => {
    const { load, seen } = teamAccess("full");
    const response = await requireKeyAllowedOn(
      automationsKey,
      { repoId: "r1" },
      load
    );
    expect(response?.status).toBe(403);
    const body = await response?.json();
    expect(body?.error.message).toMatch(/Automations only/);
    expect(seen).toEqual([]);
  });

  it("should let a full-access key act on personal work", async () => {
    const { load } = teamAccess(null);
    expect(
      await requireKeyAllowedOn(fullKey, { repoId: "r1" }, load)
    ).toBeNull();
  });

  it("should refuse a full-access key on a team that holds keys to automations", async () => {
    const { load } = teamAccess("automations");
    const response = await requireKeyAllowedOn(
      fullKey,
      { installationId: 7 },
      load
    );
    expect(response?.status).toBe(403);
    const body = await response?.json();
    expect(body?.error.code).toBe("AUTOMATION_REQUIRED");
    expect(body?.error.message).toMatch(/team owner/);
  });

  it("should check every target, so moving an automation into a restricted team is refused", async () => {
    const seen: TeamKeyAccessTarget[] = [];
    const load: LoadTeamKeyAccess = async (_userId, target) => {
      seen.push(target);
      return "installationId" in target ? "automations" : null;
    };
    const response = await requireKeyAllowedOn(
      fullKey,
      [{ automationId: "a1" }, { installationId: 9 }],
      load
    );
    expect(response?.status).toBe(403);
    expect(seen).toEqual([{ automationId: "a1" }, { installationId: 9 }]);
  });

  it("should fail closed when the team policy cannot be read", async () => {
    const response = await requireKeyAllowedOn(
      fullKey,
      { repoId: "r1" },
      failingLoad
    );
    expect(response?.status).toBe(503);
  });
});

describe("resolveAutomationOnly", () => {
  it("should hold a full-access key to automations on a restricted team", async () => {
    const { load } = teamAccess("automations");
    expect(
      await resolveAutomationOnly(fullKey, { repoId: "r1" }, load)
    ).toEqual({ ok: true, automationOnly: true });
  });

  it("should leave a full-access key unrestricted on personal work", async () => {
    const { load } = teamAccess(null);
    expect(
      await resolveAutomationOnly(fullKey, { repoId: "r1" }, load)
    ).toEqual({ ok: true, automationOnly: false });
  });

  it("should never restrict an interactive login", async () => {
    expect(
      await resolveAutomationOnly(login, { repoId: "r1" }, failingLoad)
    ).toEqual({ ok: true, automationOnly: false });
  });

  it("should fail closed when the team policy cannot be read", async () => {
    const result = await resolveAutomationOnly(
      fullKey,
      { repoId: "r1" },
      failingLoad
    );
    expect(result.ok).toBe(false);
  });
});
