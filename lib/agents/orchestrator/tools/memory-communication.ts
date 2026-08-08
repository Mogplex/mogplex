/**
 * Memory and communication tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";

// --- Memory tool definitions ---

export const MEMORY_TOOLS: OrchestratorToolDef[] = [
  {
    name: "memory_write",
    category: "memory",
    description: "Store information in agent memory",
    access: "mutation",
    implemented: true,
  },
  {
    name: "memory_search",
    category: "memory",
    description: "Search agent memory for relevant context",
    access: "read",
    implemented: true,
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
  },
  {
    name: "web_fetch",
    category: "memory",
    description: "Fetch content from a URL",
    access: "read",
    implemented: true,
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

// --- Schema map for stub tools ---

export const MEMORY_COMMUNICATION_SCHEMAS: Record<string, z.ZodType> = {
  memory_write: memoryWriteSchema,
  memory_search: memorySearchSchema,
  read_spec: readSpecSchema,
  summarize_history: summarizeHistorySchema,
  notify_operator: notifyOperatorSchema,
  post_to_inbox: postToInboxSchema,
  answer_context_chat: answerContextChatSchema,
  handoff_note: handoffNoteSchema,
};
