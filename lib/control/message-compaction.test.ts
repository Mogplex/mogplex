import { describe, expect, it } from "vitest";
import {
  buildSummaryMessage,
  COMPACTION_SUMMARY_PREFIX,
  estimateMessagesChars,
  planCompaction,
  serializeForSummary,
  type CompactableMessage,
} from "./message-compaction";

function msg(
  role: CompactableMessage["role"],
  text: string
): CompactableMessage {
  return { role, parts: [{ type: "text", text }] };
}

function conversation(turns: number, textLength = 100): CompactableMessage[] {
  return Array.from({ length: turns }, (_, i) => [
    msg("user", `u${i} ${"x".repeat(textLength)}`),
    msg("assistant", `a${i} ${"y".repeat(textLength)}`),
  ]).flat();
}

describe("estimateMessagesChars", () => {
  it("should sum text across all parts and messages", () => {
    const messages = [msg("user", "abc"), msg("assistant", "defgh")];
    expect(estimateMessagesChars(messages)).toBe(8);
  });
});

describe("planCompaction", () => {
  it("should not compact when under the char budget", () => {
    const plan = planCompaction(conversation(10), { charBudget: 1_000_000 });
    expect(plan.compact).toBe(false);
  });

  it("should not compact when over budget but at or below the keep window", () => {
    const plan = planCompaction(conversation(3), {
      charBudget: 10,
      keepRecent: 6,
    });
    expect(plan.compact).toBe(false);
  });

  it("should split into summarized head and retained tail when over budget", () => {
    const messages = conversation(20);
    const plan = planCompaction(messages, { charBudget: 100, keepRecent: 6 });
    if (!plan.compact) throw new Error("expected compaction");
    expect(plan.toSummarize.length + plan.recent.length).toBe(messages.length);
    expect(plan.recent.length).toBe(6);
    expect(plan.toSummarize[0]).toBe(messages[0]);
    expect(plan.recent.at(-1)).toBe(messages.at(-1));
  });

  it("should open the retained tail with a user message", () => {
    const messages = conversation(20);
    // keepRecent = 5 would open the window on an assistant message; the plan
    // must advance the split so the tail starts at the next user turn.
    const plan = planCompaction(messages, { charBudget: 100, keepRecent: 5 });
    if (!plan.compact) throw new Error("expected compaction");
    expect(plan.recent[0].role).toBe("user");
    expect(plan.recent.length).toBe(4);
  });

  it("should keep the original window when the tail has no user message", () => {
    const messages = [
      msg("user", "x".repeat(200)),
      msg("assistant", "y".repeat(200)),
      msg("assistant", "z".repeat(200)),
      msg("assistant", "w".repeat(200)),
    ];
    const plan = planCompaction(messages, { charBudget: 100, keepRecent: 2 });
    if (!plan.compact) throw new Error("expected compaction");
    expect(plan.recent.length).toBe(2);
    expect(plan.recent[0].role).toBe("assistant");
  });
});

describe("serializeForSummary", () => {
  it("should label each message with its uppercased role", () => {
    const serialized = serializeForSummary([
      msg("user", "hello"),
      msg("assistant", "hi there"),
    ]);
    expect(serialized).toBe("USER: hello\n\nASSISTANT: hi there");
  });
});

describe("buildSummaryMessage", () => {
  it("should produce a user message carrying the summary prefix", () => {
    const summary = buildSummaryMessage("We planned the onboarding flow.");
    expect(summary.role).toBe("user");
    expect(summary.parts[0].text).toBe(
      `${COMPACTION_SUMMARY_PREFIX}\nWe planned the onboarding flow.`
    );
  });
});
