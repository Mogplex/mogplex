import { describe, expect, it } from "vitest";
import { getDecisionDefinition } from "./definitions";
import { parseDecisionModeOverrides, resolveDecisionMode } from "./modes";

const commandRisk = getDecisionDefinition("command_risk");

describe("parseDecisionModeOverrides", () => {
  it("should keep valid modes and drop unknown values", () => {
    expect(
      parseDecisionModeOverrides(
        '{"loop_check":"advise","command_risk":"always","x":3}'
      )
    ).toEqual({ loop_check: "advise" });
  });

  it("should ignore malformed or non-object JSON", () => {
    expect(parseDecisionModeOverrides("{nope")).toEqual({});
    expect(parseDecisionModeOverrides('["enforce"]')).toEqual({});
    expect(parseDecisionModeOverrides(undefined)).toEqual({});
  });
});

describe("resolveDecisionMode", () => {
  it("should use the per-surface default before the general default", () => {
    expect(resolveDecisionMode(commandRisk, "control", {})).toBe("enforce");
    expect(resolveDecisionMode(commandRisk, "agent_tool", {})).toBe("shadow");
  });

  it("should prefer a surface override over an id override", () => {
    const env = {
      DECISION_MODES:
        '{"command_risk":"off","command_risk.agent_tool":"enforce"}',
    };
    expect(resolveDecisionMode(commandRisk, "agent_tool", env)).toBe("enforce");
    expect(resolveDecisionMode(commandRisk, "control", env)).toBe("off");
  });

  it("should turn everything off when the kill switch is set", () => {
    const env = {
      DECISIONS_DISABLED: "1",
      DECISION_MODES: '{"command_risk":"enforce"}',
    };
    expect(resolveDecisionMode(commandRisk, "control", env)).toBe("off");
  });

  it("should fall back to defaults when the override map is invalid", () => {
    expect(
      resolveDecisionMode(commandRisk, "control", { DECISION_MODES: "{bad" })
    ).toBe("enforce");
  });
});
