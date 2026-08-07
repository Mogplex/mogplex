import { randomUUID } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import {
  agentCheckpointSchema,
  HANDOFF_USER_MESSAGE_MAX_CHARS,
  HANDOFF_USER_MESSAGES_TOTAL_MAX_CHARS,
  CHECKPOINT_SCHEMA_VERSION,
  type AgentCheckpoint,
  type AgentCheckpointBody,
  type CompactableAgentMessage,
} from "./types";
import { extractMessageText } from "./plan";

/**
 * Builds the structured checkpoint object from the covered slice of a
 * conversation, and renders the prose handoff the model actually sees. The
 * object is the source of truth; the handoff is derived from it.
 */

const SERIALIZED_PART_MAX_CHARS = 1_500;
const SERIALIZED_TRANSCRIPT_MAX_CHARS = 400_000;

const CHECKPOINT_SYSTEM_PROMPT = `You are compacting an agent conversation into a structured checkpoint so a fresh context can continue the work seamlessly.

Rules:
- Record only what the transcript supports; never invent files, results, or decisions.
- Quote user-stated constraints with their exact wording.
- Open blockers, approvals, destructive actions, and security findings must never be dropped.
- changedFiles must be exact paths that appear in the transcript.
- nextAction must be executable from this checkpoint alone.`;

export type CheckpointGenerator = (input: {
  model: LanguageModel;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}) => Promise<AgentCheckpointBody>;

export const generateCheckpointObject: CheckpointGenerator = async (input) => {
  const { object } = await generateObject({
    model: input.model,
    system: input.system,
    prompt: input.prompt,
    schema: agentCheckpointSchema,
    abortSignal: input.abortSignal,
  });
  return object;
};

function serializePart(part: unknown): string {
  if (
    part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  ) {
    return (part as { text: string }).text;
  }
  try {
    const json = JSON.stringify(part) ?? "";
    return json.length > SERIALIZED_PART_MAX_CHARS
      ? `${json.slice(0, SERIALIZED_PART_MAX_CHARS)}…[truncated]`
      : json;
  } catch {
    return "[unserializable part]";
  }
}

/** Role-labeled transcript of the covered messages for the compactor model. */
export function serializeCoveredTranscript(
  messages: readonly CompactableAgentMessage[]
): string {
  const sections: string[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      sections.push(`${message.role.toUpperCase()}: ${message.content}`);
      continue;
    }
    const parts = Array.isArray(message.parts)
      ? message.parts
      : Array.isArray(message.content)
        ? message.content
        : [];
    const body = parts.map(serializePart).filter(Boolean).join("\n");
    sections.push(`${message.role.toUpperCase()}: ${body}`);
  }
  const transcript = sections.join("\n\n");
  // Guard the compactor call itself: keep the newest portion, which contains
  // the freshest state, when an extreme transcript would not fit.
  return transcript.length > SERIALIZED_TRANSCRIPT_MAX_CHARS
    ? transcript.slice(-SERIALIZED_TRANSCRIPT_MAX_CHARS)
    : transcript;
}

export async function buildCheckpoint(input: {
  covered: readonly CompactableAgentMessage[];
  model: LanguageModel;
  compactorModelId: string;
  parentCheckpointId: string | null;
  generate?: CheckpointGenerator;
  abortSignal?: AbortSignal;
}): Promise<AgentCheckpoint> {
  const generate = input.generate ?? generateCheckpointObject;
  const transcript = serializeCoveredTranscript(input.covered);
  const body = await generate({
    model: input.model,
    system: CHECKPOINT_SYSTEM_PROMPT,
    prompt: `Compact the following conversation into a checkpoint.\n\n<transcript>\n${transcript}\n</transcript>`,
    abortSignal: input.abortSignal,
  });
  return {
    ...body,
    provenance: {
      id: randomUUID(),
      parentCheckpointId: input.parentCheckpointId,
      createdAt: new Date().toISOString(),
      coveredMessageCount: input.covered.length,
      compactorModel: input.compactorModelId,
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    },
  };
}

/**
 * Covered user messages carried into the handoff verbatim (capped). User
 * words get maximum fidelity: summarization may compress everything else,
 * but never the user's own instructions.
 */
export function collectVerbatimUserMessages(
  covered: readonly CompactableAgentMessage[]
): string[] {
  const collected: string[] = [];
  let total = 0;
  for (const message of covered) {
    if (message.role !== "user") continue;
    const text = extractMessageText(message).trim();
    if (!text) continue;
    const clipped =
      text.length > HANDOFF_USER_MESSAGE_MAX_CHARS
        ? `${text.slice(0, HANDOFF_USER_MESSAGE_MAX_CHARS)}…[truncated]`
        : text;
    if (total + clipped.length > HANDOFF_USER_MESSAGES_TOTAL_MAX_CHARS) break;
    total += clipped.length;
    collected.push(clipped);
  }
  return collected;
}

function renderList(label: string, items: readonly string[]): string {
  if (items.length === 0) return `${label}: none`;
  return `${label}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

export const HANDOFF_PREFIX =
  "[Context checkpoint — the earlier conversation was compacted. Continue the work below; do not restart it or re-do completed items.]";

/** Render the prose handoff message from the checkpoint object. */
export function renderHandoff(
  checkpoint: AgentCheckpoint,
  verbatimUserMessages: readonly string[]
): string {
  const sections = [
    HANDOFF_PREFIX,
    `Original request: ${checkpoint.task.originalRequest}`,
    `Current objective: ${checkpoint.task.currentObjective}`,
    renderList("Completed", checkpoint.progress.completed),
    `Active: ${checkpoint.progress.active ?? "none"}`,
    renderList("Remaining", checkpoint.progress.remaining),
    renderList("Blockers", checkpoint.progress.blockers),
    renderList("Decisions", checkpoint.state.decisions),
    renderList("Assumptions", checkpoint.state.assumptions),
    renderList("User constraints (verbatim)", checkpoint.state.constraints),
    renderList(
      "Rejected approaches (do not retry)",
      checkpoint.state.rejectedApproaches
    ),
    renderList("Changed files", checkpoint.workspace.changedFiles),
    renderList("Relevant files", checkpoint.workspace.relevantFiles),
    renderList(
      "Evidence",
      checkpoint.evidence.map(
        (item) =>
          `${item.kind} ${item.ref}${item.note ? ` — ${item.note}` : ""}`
      )
    ),
    renderList("Unresolved questions", checkpoint.unresolvedQuestions),
    `Next action: ${checkpoint.continuity.nextAction}`,
    renderList("Warnings", checkpoint.continuity.warnings),
  ];
  if (verbatimUserMessages.length > 0) {
    sections.push(
      renderList(
        "Earlier user messages preserved verbatim",
        verbatimUserMessages as string[]
      )
    );
  }
  return sections.join("\n\n");
}
