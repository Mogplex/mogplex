import { describe, expect, it } from "vitest";
import {
  estimateMessagesChars,
  extractMessageText,
  hashMessagePrefix,
  matchCheckpointPrefix,
  planCompactionSplit,
} from "./plan";
import type { CompactableAgentMessage } from "./types";

function msg(
  role: string,
  text: string,
  extra?: Record<string, unknown>
): CompactableAgentMessage {
  return { role, content: text, ...extra };
}

function partsMsg(role: string, text: string): CompactableAgentMessage {
  return { role, parts: [{ type: "text", text }] };
}

describe("extractMessageText", () => {
  it("should read string content", () => {
    expect(extractMessageText(msg("user", "hello"))).toBe("hello");
  });

  it("should read UIMessage parts arrays", () => {
    expect(extractMessageText(partsMsg("user", "hi"))).toBe("hi");
  });

  it("should read content parts arrays and skip non-text parts", () => {
    const message: CompactableAgentMessage = {
      role: "user",
      content: [
        { type: "text", text: "a" },
        { type: "file", url: "x" },
        { type: "text", text: "b" },
      ],
    };
    expect(extractMessageText(message)).toBe("a\nb");
  });
});

describe("planCompactionSplit", () => {
  const big = "x".repeat(300);

  it("should not compact under the char budget", () => {
    const result = planCompactionSplit([msg("user", "hi")], {
      charBudget: 1_000,
      keepRecent: 2,
    });
    expect(result.compact).toBe(false);
  });

  it("should split so the retained window opens with a user message", () => {
    const messages = [
      msg("user", big),
      msg("assistant", big),
      msg("user", big),
      msg("assistant", big),
      msg("user", big),
      msg("assistant", big),
    ];
    const result = planCompactionSplit(messages, {
      charBudget: 500,
      keepRecent: 3,
    });
    if (!result.compact) throw new Error("expected compaction");
    expect(result.recent[0].role).toBe("user");
    expect(result.covered.length + result.recent.length).toBe(messages.length);
  });

  it("should keep leading system messages out of the covered slice", () => {
    const messages = [
      msg("system", "policy"),
      msg("user", big),
      msg("assistant", big),
      msg("user", big),
      msg("assistant", big),
      msg("user", big),
      msg("assistant", big),
    ];
    const result = planCompactionSplit(messages, {
      charBudget: 500,
      keepRecent: 2,
    });
    if (!result.compact) throw new Error("expected compaction");
    expect(result.leadingSystem).toHaveLength(1);
    expect(result.leadingSystem[0].role).toBe("system");
    expect(result.covered.every((m) => m.role !== "system")).toBe(true);
  });

  it("should not compact when only the recent window remains", () => {
    const messages = [msg("user", big), msg("assistant", big)];
    const result = planCompactionSplit(messages, {
      charBudget: 100,
      keepRecent: 4,
    });
    expect(result.compact).toBe(false);
  });
});

describe("hashMessagePrefix", () => {
  it("should be stable when cosmetic metadata changes", () => {
    const a = [msg("user", "hello", { id: "1" })];
    const b = [msg("user", "hello", { id: "1", metadata: { extra: true } })];
    expect(hashMessagePrefix(a)).toBe(hashMessagePrefix(b));
  });

  it("should change when text or role changes", () => {
    expect(hashMessagePrefix([msg("user", "a")])).not.toBe(
      hashMessagePrefix([msg("user", "b")])
    );
    expect(hashMessagePrefix([msg("user", "a")])).not.toBe(
      hashMessagePrefix([msg("assistant", "a")])
    );
  });
});

describe("matchCheckpointPrefix", () => {
  const history = [
    msg("user", "one"),
    msg("assistant", "two"),
    msg("user", "three"),
  ];

  it("should return the suffix when the prefix matches", () => {
    const stored = {
      prefixHash: hashMessagePrefix(history.slice(0, 2)),
      coveredMessageCount: 2,
    };
    const match = matchCheckpointPrefix(history, stored);
    expect(match).not.toBeNull();
    expect(match?.suffix.map((m) => extractMessageText(m))).toEqual(["three"]);
  });

  it("should skip leading system messages before matching", () => {
    const withSystem = [msg("system", "policy"), ...history];
    const stored = {
      prefixHash: hashMessagePrefix(history.slice(0, 2)),
      coveredMessageCount: 2,
    };
    const match = matchCheckpointPrefix(withSystem, stored);
    expect(match).not.toBeNull();
    expect(match?.leadingSystem).toHaveLength(1);
    expect(match?.suffix).toHaveLength(1);
  });

  it("should return null when the history was edited", () => {
    const stored = {
      prefixHash: hashMessagePrefix([msg("user", "different")]),
      coveredMessageCount: 1,
    };
    expect(matchCheckpointPrefix(history, stored)).toBeNull();
  });

  it("should return null when the covered range exceeds the history", () => {
    const stored = {
      prefixHash: hashMessagePrefix(history),
      coveredMessageCount: 5,
    };
    expect(matchCheckpointPrefix(history, stored)).toBeNull();
  });
});

describe("estimateMessagesChars", () => {
  it("should grow with content size", () => {
    expect(
      estimateMessagesChars([msg("user", "x".repeat(100))])
    ).toBeGreaterThan(estimateMessagesChars([msg("user", "x")]));
  });
});
