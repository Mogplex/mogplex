import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { Tool } from "ai";
import type { ConversationSkills } from "@/lib/skill-catalog/chat";
import { catalogOf, skillRow } from "@/lib/skill-catalog/test-fixtures";
import {
  composeChatSystemPrompt,
  createChatModelStream,
  type ChatModelStreamDeps,
} from "./run-chat";

const skills = catalogOf(
  skillRow("Deploy checklist", { content: "1. Run the tests." }),
  skillRow("Release notes", { content: "Group changes by area." })
);

function userMessage(text: string) {
  return {
    id: text,
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  };
}

async function systemPromptFor(input: {
  texts: string[];
  tools: Record<string, Tool>;
  enableTools?: boolean;
  systemSuffix?: string;
  attachedSkillIds?: string[];
  onSkillsResolved?: (skills: ConversationSkills) => void;
}) {
  let seen = "";
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      seen = JSON.stringify(options.prompt);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      };
    },
  });
  const resolveSkills = vi.fn(async () => ({
    invoked: skills.filter((skill) =>
      input.texts.some((text) => text.includes(skill.slug))
    ),
    available: skills,
  }));
  const deps: Partial<ChatModelStreamDeps> = {
    resolveModel: (async () => ({
      model,
      providerOptions: undefined,
    })) as unknown as ChatModelStreamDeps["resolveModel"],
    buildTools: (async () => ({
      tools: input.tools,
      connections: [],
      cleanup: async () => {},
    })) as unknown as ChatModelStreamDeps["buildTools"],
    resolveSkills,
  };
  const { result } = await createChatModelStream({
    context: {
      userId: "user-1",
      repoId: "repo-1",
      enableTools: input.enableTools,
    },
    resolvedModel: "test/model",
    uiMessages: input.texts.map(userMessage),
    systemSuffix: input.systemSuffix,
    attachedSkillIds: input.attachedSkillIds,
    onSkillsResolved: input.onSkillsResolved,
    deps,
  });
  await result.consumeStream();
  return { system: seen, resolveSkills };
}

const loadSkillTool = { load_skill: {} as Tool };

describe("createChatModelStream skills", () => {
  it("should hand the model an invoked skill and index the rest", async () => {
    const { system, resolveSkills } = await systemPromptFor({
      texts: ["/deploy-checklist staging", "now production"],
      tools: loadSkillTool,
      systemSuffix: "<memory-context>m</memory-context>",
    });
    expect(resolveSkills).toHaveBeenCalledWith({
      userId: "user-1",
      repoId: "repo-1",
      userTexts: ["/deploy-checklist staging", "now production"],
    });
    expect(system).toContain("1. Run the tests.");
    expect(system).toContain("$release-notes: Release notes");
    expect(system).not.toContain("Group changes by area.");
    expect(system.indexOf("<skills>")).toBeLessThan(
      system.indexOf("<memory-context>")
    );
  });

  it("should leave the index out when the agent holds no load_skill tool", async () => {
    const { system } = await systemPromptFor({
      texts: ["use $release-notes"],
      tools: {},
    });
    expect(system).toContain("Group changes by area.");
    expect(system).not.toContain("Available skills");
  });

  it("should not repeat a skill the caller already delivers", async () => {
    const { system } = await systemPromptFor({
      texts: ["/deploy-checklist staging"],
      tools: loadSkillTool,
      attachedSkillIds: [skills[0].id],
    });
    expect(system).not.toContain("1. Run the tests.");
    expect(system).not.toContain("Invoked skills");
    expect(system).toContain("$release-notes: Release notes");
  });

  it("should report the skills in play, minus what the caller already delivers", async () => {
    const seen: ConversationSkills[] = [];
    await systemPromptFor({
      texts: ["/deploy-checklist and $release-notes"],
      tools: loadSkillTool,
      attachedSkillIds: [skills[1].id],
      onSkillsResolved: (resolved) => seen.push(resolved),
    });
    expect(seen).toEqual([{ invoked: [skills[0]], available: [skills[0]] }]);
  });

  it("should still answer when the skills observer throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { system } = await systemPromptFor({
      texts: ["/deploy-checklist"],
      tools: loadSkillTool,
      onSkillsResolved: () => {
        throw new Error("observer broke");
      },
    });
    expect(system).toContain("1. Run the tests.");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("should leave the index out when tools are switched off", async () => {
    const { system } = await systemPromptFor({
      texts: ["hello"],
      tools: loadSkillTool,
      enableTools: false,
    });
    expect(system).not.toContain("<skills>");
  });
});

describe("composeChatSystemPrompt", () => {
  it("should skip empty sections", () => {
    expect(composeChatSystemPrompt(["base", null, " ", "suffix"])).toBe(
      "base\n\nsuffix"
    );
  });
});
