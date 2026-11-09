/**
 * Memory and communication tools for the orchestrator.
 */
import { z } from "zod";
import {
  createMemoryTools,
  createSkillTools,
  webFetch,
  webSearch,
} from "@/lib/agents/tools";
import type { OrchestratorToolContext, OrchestratorToolDef } from "../types";
import {
  createHandoffNoteTool,
  createSummarizeHistoryTool,
} from "./memory-impl";

const memoryToolsByContext = new WeakMap<
  OrchestratorToolContext,
  Record<string, import("ai").Tool>
>();

function memoryToolsFor(ctx: OrchestratorToolContext) {
  const existing = memoryToolsByContext.get(ctx);
  if (existing) return existing;
  const tools = createMemoryTools(ctx.userId, ctx.repoId ?? undefined, {
    workspaceSessionId: ctx.workspaceSessionId ?? null,
    conversationId: ctx.conversationId ?? null,
    sandboxId: () => ctx.sandboxBinding?.sandboxId ?? ctx.sandboxId ?? null,
  });
  memoryToolsByContext.set(ctx, tools);
  return tools;
}

const skillToolsByContext = new WeakMap<
  OrchestratorToolContext,
  Record<string, import("ai").Tool>
>();

function skillToolsFor(ctx: OrchestratorToolContext) {
  const existing = skillToolsByContext.get(ctx);
  if (existing) return existing;
  const tools = createSkillTools({
    userId: ctx.userId,
    repoId: ctx.repoId ?? null,
  });
  skillToolsByContext.set(ctx, tools);
  return tools;
}

// --- Memory tool definitions ---

export const MEMORY_TOOLS: OrchestratorToolDef[] = [
  {
    name: "memory_write",
    category: "memory",
    description: "Store information in agent memory",
    access: "mutation",
    implemented: true,
    build: (ctx) => memoryToolsFor(ctx).add_memory,
  },
  {
    name: "memory_search",
    category: "memory",
    description: "Search agent memory for relevant context",
    access: "read",
    implemented: true,
    build: (ctx) => memoryToolsFor(ctx).search_memories,
  },
  {
    name: "find_skills",
    category: "memory",
    description: "Search the operator's skills for a task",
    access: "read",
    implemented: true,
    build: (ctx) => skillToolsFor(ctx).find_skills,
  },
  {
    name: "load_skill",
    category: "memory",
    description: "Load one of the operator's skills by slug",
    access: "read",
    implemented: true,
    build: (ctx) => skillToolsFor(ctx).load_skill,
  },
  {
    name: "read_spec",
    category: "memory",
    description: "Read a spec document from the specs directory",
    access: "read",
    implemented: false,
  },
  {
    name: "summarize_history",
    category: "memory",
    description: "Summarize conversation or execution history",
    access: "read",
    implemented: true,
    build: (ctx) => createSummarizeHistoryTool(ctx),
  },
  {
    name: "web_fetch",
    category: "memory",
    description: "Fetch content from a URL",
    access: "read",
    implemented: true,
    build: () => webFetch,
  },
  {
    name: "web_search",
    category: "memory",
    description: "Search documentation and public resources with Exa",
    access: "read",
    implemented: true,
    build: () => webSearch,
  },
];

// --- Communication tool definitions ---

export const COMMUNICATION_TOOLS: OrchestratorToolDef[] = [
  {
    name: "notify_operator",
    category: "communication",
    description: "Send a notification to the operator",
    access: "mutation",
    implemented: false,
  },
  {
    name: "post_to_inbox",
    category: "communication",
    description: "Post an item to the operator's approval inbox",
    access: "mutation",
    implemented: false,
  },
  {
    name: "answer_context_chat",
    category: "communication",
    description: "Respond to a contextual question from the operator",
    access: "read",
    implemented: false,
  },
  {
    name: "handoff_note",
    category: "communication",
    description: "Leave a note for the next agent or operator",
    access: "mutation",
    implemented: true,
    build: (ctx) => createHandoffNoteTool(ctx),
  },
];

// --- Memory schemas ---

export const memoryWriteSchema = z.object({
  lane: z
    .enum(["session", "semantic", "episodic", "procedural"])
    .describe("Memory lane"),
  content: z.string().describe("Content to store"),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional small JSON object of tags"),
});

export const memorySearchSchema = z.object({
  query: z.string().describe("Search query"),
  limit: z.number().optional().describe("Max results"),
});

export const findSkillsSchema = z.object({
  query: z.string().optional().describe("What the task involves"),
  limit: z.number().optional().describe("Max results"),
});

export const loadSkillSchema = z.object({
  slug: z.string().describe("Skill slug"),
});

export const readSpecSchema = z.object({
  specPath: z.string().describe("Path to spec file"),
});

export const summarizeHistorySchema = z.object({
  maxTurns: z.number().optional().describe("Max turns to summarize"),
  focus: z.string().optional().describe("Focus area for summary"),
});

// --- Communication schemas ---

export const notifyOperatorSchema = z.object({
  message: z.string().describe("Notification message"),
  channel: z.enum(["inbox", "slack", "email"]).optional().describe("Channel"),
});

export const postToInboxSchema = z.object({
  title: z.string().describe("Item title"),
  body: z.string().describe("Item body"),
  actionRequired: z.boolean().optional().describe("Requires action"),
});

export const answerContextChatSchema = z.object({
  questionId: z.string().describe("Question ID to answer"),
  answer: z.string().describe("Answer content"),
});

export const handoffNoteSchema = z.object({
  note: z.string().describe("Handoff note content"),
  forAgent: z.string().optional().describe("Target agent"),
});
