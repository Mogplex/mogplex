import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import {
  compactChatMessagesForModel,
  type ChatCompactionDeps,
} from "./chat-adapter";
import {
  extractMessageText,
  HANDOFF_PREFIX,
  type CheckpointGenerator,
} from "./index";
import type { AgentCheckpointBody } from "./types";

// The control-chat message shape: role-narrowed, text parts only, no ids.
// The chat route's UIMessages are a superset; testing with the narrower type
// pins the adapter's generic contract for both callers.
type ControlMessage = {
  role: "user" | "assistant" | "system";
  parts: Array<{ type: "text"; text: string }>;
};

function msg(role: ControlMessage["role"], text: string): ControlMessage {
  return { role, parts: [{ type: "text", text }] };
}

const big = "z".repeat(400);

function longHistory(turns: number): ControlMessage[] {
  return Array.from({ length: turns }, (_, index) => [
    msg("user", index === 0 ? "build the widget" : `ask ${index} ${big}`),
    msg("assistant", `reply ${index} ${big}`),
  ]).flat();
}

function makeBody(overrides?: {
  changedFiles?: string[];
}): AgentCheckpointBody {
  return {
    task: {
      originalRequest: "build the widget",
      currentObjective: "finish the widget",
    },
    progress: { completed: [], active: null, remaining: [], blockers: [] },
    state: {
      decisions: [],
      assumptions: [],
      constraints: [],
      rejectedApproaches: [],
    },
    workspace: {
      changedFiles: overrides?.changedFiles ?? [],
      relevantFiles: [],
    },
    evidence: [],
    unresolvedQuestions: [],
    continuity: { nextAction: "continue building", warnings: [] },
  };
}

const okGenerator: CheckpointGenerator = async () => makeBody();

const model = "fake-model" as unknown as LanguageModel;

function makeDeps(overrides?: Partial<ChatCompactionDeps>): {
  deps: ChatCompactionDeps;
  persisted: Array<Record<string, unknown>>;
  calls: { load: number; resolve: number };
} {
  const persisted: Array<Record<string, unknown>> = [];
  const calls = { load: 0, resolve: 0 };
  const deps: ChatCompactionDeps = {
    loadLatestCompaction: async () => {
      calls.load += 1;
      return null;
    },
    persistCompactionEvent: async (event) => {
      persisted.push(event as unknown as Record<string, unknown>);
    },
    resolveModel: (async () => {
      calls.resolve += 1;
      return { model, providerOptions: undefined };
    }) as unknown as ChatCompactionDeps["resolveModel"],
    generate: okGenerator,
    charBudget: 1_000,
    keepRecent: 3,
    ...overrides,
  };
  return { deps, persisted, calls };
}

const baseInput = {
  userId: "user-1",
  conversationId: "conv-1",
  repoId: "repo-1",
  aiCallId: "call-1",
  resolvedModel: "anthropic/claude-sonnet-5",
  teamId: null,
};

describe("compactChatMessagesForModel", () => {
  it("should return an over-budget history as [handoff, ...recent] and persist the checkpoint", async () => {
    const { deps, persisted } = makeDeps();
    const messages = longHistory(6);
    const result = await compactChatMessagesForModel(
      { ...baseInput, uiMessages: messages },
      deps
    );

    expect(result.length).toBeLessThan(messages.length);
    expect(extractMessageText(result[0])).toContain(HANDOFF_PREFIX);
    // Handoff is caller-shaped: a user turn with text parts.
    expect(result[0].role).toBe("user");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      aiCallId: "call-1",
      conversationId: "conv-1",
      repoId: "repo-1",
      userId: "user-1",
    });
  });

  it("should pass an under-budget history through untouched without loading state", async () => {
    const { deps, persisted, calls } = makeDeps();
    const messages = [msg("user", "hi"), msg("assistant", "hello")];
    const result = await compactChatMessagesForModel(
      { ...baseInput, uiMessages: messages },
      deps
    );
    expect(result).toEqual(messages);
    expect(persisted).toHaveLength(0);
    expect(calls.load).toBe(0);
    expect(calls.resolve).toBe(0);
  });

  it("should skip compaction entirely without a conversation id", async () => {
    const { deps, calls } = makeDeps();
    const messages = longHistory(6);
    const result = await compactChatMessagesForModel(
      { ...baseInput, conversationId: null, uiMessages: messages },
      deps
    );
    expect(result).toEqual(messages);
    expect(calls.load).toBe(0);
  });

  it("should degrade to the original history when checkpoint generation fails, persisting the audit event", async () => {
    // A checkpoint claiming a file the transcript never mentioned fails the
    // deterministic validation pass.
    const failingGenerator: CheckpointGenerator = async () =>
      makeBody({ changedFiles: ["lib/never-mentioned.ts"] });
    const { deps, persisted } = makeDeps({ generate: failingGenerator });
    const messages = longHistory(6);
    const result = await compactChatMessagesForModel(
      { ...baseInput, uiMessages: messages },
      deps
    );
    expect(result).toEqual(messages);
    // Failed validation still leaves an audit row.
    expect(persisted).toHaveLength(1);
  });

  it("should degrade to the original history when a boundary throws", async () => {
    const { deps } = makeDeps({
      loadLatestCompaction: async () => {
        throw new Error("db down");
      },
    });
    const messages = longHistory(6);
    const result = await compactChatMessagesForModel(
      { ...baseInput, uiMessages: messages },
      deps
    );
    expect(result).toEqual(messages);
  });
});
