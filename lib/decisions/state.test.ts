import { describe, expect, it } from "vitest";
import {
  buildDecisionState,
  clipText,
  DECISION_STATE_MAX_CHARS,
} from "./state";

describe("clipText", () => {
  it("should serialize non-strings and mark truncation", () => {
    expect(clipText({ a: 1 }, 50)).toBe('{"a":1}');
    expect(clipText("abcdef", 3)).toBe("abc…");
    expect(clipText(undefined, 10)).toBe('""');
  });
});

describe("buildDecisionState", () => {
  it("should redact secret-shaped values before state leaves the process", () => {
    const state = buildDecisionState({
      command:
        "curl -H 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789'",
      apiKey: "sk-live-123",
    }) as Record<string, string>;
    expect(JSON.stringify(state)).not.toContain(
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
    );
    expect(state.apiKey).not.toBe("sk-live-123");
  });

  it("should pass small state through unchanged", () => {
    expect(buildDecisionState({ command: "git status" })).toEqual({
      command: "git status",
    });
  });

  it("should bound oversized state to the model limit", () => {
    const big = Array.from({ length: 40 }, () => "x".repeat(5000));
    const state = buildDecisionState(big) as {
      truncated: boolean;
      content: string;
    };
    expect(state.truncated).toBe(true);
    expect(state.content).toHaveLength(DECISION_STATE_MAX_CHARS);
  });
});
