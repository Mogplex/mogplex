import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  createResolveActiveTeamCapabilities,
  createResolveMemberCapabilities,
  hasCapability,
  presetForRole,
  ROLE_PRESETS,
} from "./team-capabilities";

describe("hasCapability", () => {
  it("'*' grants everything", () => {
    const caps = new Set(["*"]);
    expect(hasCapability(caps, "tools.bash")).toBe(true);
    expect(hasCapability(caps, "models.openai.gpt-5")).toBe(true);
    expect(hasCapability(caps, "anything.at.all")).toBe(true);
  });

  it("exact match", () => {
    const caps = new Set(["tools.bash"]);
    expect(hasCapability(caps, "tools.bash")).toBe(true);
    expect(hasCapability(caps, "tools.write_file")).toBe(false);
  });

  it("single-level wildcard matches direct children and self-namespace", () => {
    const caps = new Set(["tools.*"]);
    expect(hasCapability(caps, "tools.bash")).toBe(true);
    expect(hasCapability(caps, "tools.web_search")).toBe(true);
  });

  it("wildcard covers multi-segment descendants", () => {
    const caps = new Set(["models.*"]);
    expect(hasCapability(caps, "models.openai")).toBe(true);
    expect(hasCapability(caps, "models.openai.gpt-5")).toBe(true);
    expect(hasCapability(caps, "models.anthropic.claude-sonnet-4-6")).toBe(
      true
    );
  });

  it("provider-scoped wildcard restricts to that provider", () => {
    const caps = new Set(["models.openai.*"]);
    expect(hasCapability(caps, "models.openai.gpt-5")).toBe(true);
    expect(hasCapability(caps, "models.anthropic.claude")).toBe(false);
  });

  it("empty set denies everything", () => {
    const caps = new Set<string>();
    expect(hasCapability(caps, "tools.bash")).toBe(false);
    expect(hasCapability(caps, "*")).toBe(false);
  });
});

describe("ROLE_PRESETS", () => {
  it("owner and admin get full grant", () => {
    expect(ROLE_PRESETS.owner).toEqual(["*"]);
    expect(ROLE_PRESETS.admin).toEqual(["*"]);
  });

  it("developer can run bash and write files; viewer cannot", () => {
    const dev = presetForRole("developer");
    const viewer = presetForRole("viewer");
    expect(hasCapability(dev, "tools.bash")).toBe(true);
    expect(hasCapability(dev, "tools.write_file")).toBe(true);
    expect(hasCapability(viewer, "tools.bash")).toBe(false);
    expect(hasCapability(viewer, "tools.write_file")).toBe(false);
  });

  it("viewer keeps web/docs read access", () => {
    const viewer = presetForRole("viewer");
    expect(hasCapability(viewer, "tools.web_search")).toBe(true);
    expect(hasCapability(viewer, "tools.web_fetch")).toBe(true);
    expect(hasCapability(viewer, "models.openai.gpt-5")).toBe(true);
  });

  it("developer can manage connections; viewer cannot", () => {
    expect(
      hasCapability(presetForRole("developer"), "connections.create")
    ).toBe(true);
    expect(hasCapability(presetForRole("viewer"), "connections.create")).toBe(
      false
    );
  });

  it("developer can write projects; viewer cannot", () => {
    expect(hasCapability(presetForRole("developer"), "projects.write")).toBe(
      true
    );
    expect(hasCapability(presetForRole("viewer"), "projects.write")).toBe(
      false
    );
  });
});

describe("resolveMemberCapabilities", () => {
  it("solo scope (no teamId) returns ALL_CAPABILITIES", async () => {
    const resolve = createResolveMemberCapabilities({
      lookupRole: async () => null,
    });
    const caps = await resolve("user-1", null);
    expect(caps).toBe(ALL_CAPABILITIES);
    expect(hasCapability(caps, "tools.bash")).toBe(true);
  });

  it("team scope returns the role's preset", async () => {
    const resolve = createResolveMemberCapabilities({
      lookupRole: async () => "viewer",
    });
    const caps = await resolve("user-1", "team-1");
    expect(hasCapability(caps, "tools.web_search")).toBe(true);
    expect(hasCapability(caps, "tools.bash")).toBe(false);
  });

  it("non-member of the team fails closed (empty cap set)", async () => {
    const resolve = createResolveMemberCapabilities({
      lookupRole: async () => null,
    });
    const caps = await resolve("user-1", "team-1");
    expect(caps.size).toBe(0);
    expect(hasCapability(caps, "tools.web_search")).toBe(false);
  });
});

describe("resolveActiveTeamCapabilities", () => {
  it("solo scope returns no active team context", async () => {
    let roleLookups = 0;
    const resolve = createResolveActiveTeamCapabilities({
      loadMemberRole: async () => {
        roleLookups += 1;
        return { data: null, error: null };
      },
    });

    await expect(resolve("user-1", null)).resolves.toEqual({
      ok: true,
      teamId: null,
    });
    expect(roleLookups).toBe(0);
  });

  it("team scope returns preset capabilities for members", async () => {
    const resolve = createResolveActiveTeamCapabilities({
      loadMemberRole: async (userId, teamId) => {
        expect(userId).toBe("user-1");
        expect(teamId).toBe("team-1");
        return { data: { role: "viewer" }, error: null };
      },
    });

    const result = await resolve("user-1", "team-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.teamId).toBe("team-1");
    expect(
      hasCapability(result.capabilities ?? new Set(), "models.openai")
    ).toBe(true);
    expect(hasCapability(result.capabilities ?? new Set(), "tools.bash")).toBe(
      false
    );
  });

  it("rejects non-members without falling back to solo scope", async () => {
    const resolve = createResolveActiveTeamCapabilities({
      loadMemberRole: async () => ({ data: null, error: null }),
    });

    await expect(resolve("user-1", "team-1")).resolves.toEqual({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
  });

  it("returns a 500 on membership lookup errors", async () => {
    const logs: unknown[] = [];
    const resolve = createResolveActiveTeamCapabilities({
      loadMemberRole: async () => ({
        data: null,
        error: { message: "database unavailable" },
      }),
      logError: (_message, error) => logs.push(error),
    });

    await expect(resolve("user-1", "team-1")).resolves.toEqual({
      ok: false,
      status: 500,
      error: "Internal server error",
    });
    expect(logs).toEqual([{ message: "database unavailable" }]);
  });
});
