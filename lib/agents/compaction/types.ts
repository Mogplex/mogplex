import { z } from "zod";

/**
 * Context compaction core (see compaction-plan.md in the project workspace).
 *
 * The unit of compaction is a structured checkpoint object — not a prose
 * summary. The prose handoff the model sees is rendered FROM this object; the
 * object is the source of truth, persisted for audit and reuse. Compaction is
 * invisible to users: no chat bubble, no confirmation, no memory meter. The
 * only traces are `ai_call_events` rows maintainers can inspect.
 */

export const CHECKPOINT_SCHEMA_VERSION = 1;

/**
 * Character budget before a conversation history is compacted. ~60k tokens —
 * the same predictive headroom convention the control chat established: well
 * under every supported model's context window once the system prompt and
 * tools are added, so we compact long before a provider rejects the request.
 * Model-specific thresholds learned from telemetry are a later phase.
 */
export const COMPACTION_CHAR_BUDGET = 240_000;

/** Trailing messages that survive compaction verbatim. */
export const COMPACTION_KEEP_RECENT_MESSAGES = 12;

/**
 * Mid-run (step-level) reduction: tool outputs older than this many trailing
 * model messages are demoted to typed references once they exceed
 * TOOL_OUTPUT_DEMOTION_MIN_CHARS. Deterministic only — no model call happens
 * inside a running tool loop.
 */
export const TOOL_OUTPUT_KEEP_RECENT_MESSAGES = 8;
export const TOOL_OUTPUT_DEMOTION_MIN_CHARS = 4_000;

/** Per-message and total caps for covered user messages carried verbatim. */
export const HANDOFF_USER_MESSAGE_MAX_CHARS = 2_000;
export const HANDOFF_USER_MESSAGES_TOTAL_MAX_CHARS = 24_000;

/** `ai_call_events.message` value used to find checkpoint events for reuse. */
export const COMPACTION_EVENT_MESSAGE = "compaction_checkpoint";

/**
 * Failed compactions (build error or validation failure) are audited under a
 * separate message key so the reuse lookup only ever sees valid checkpoints.
 */
export const COMPACTION_FAILED_EVENT_MESSAGE = "compaction_failed";

export const agentCheckpointSchema = z.object({
  task: z.object({
    originalRequest: z
      .string()
      .min(1)
      .describe("The user's original request, verbatim or near-verbatim"),
    currentObjective: z
      .string()
      .min(1)
      .describe("What the agent is working toward right now"),
  }),
  progress: z.object({
    completed: z.array(z.string()).describe("Work items already done"),
    active: z.string().nullable().describe("The work item in flight, if any"),
    remaining: z.array(z.string()).describe("Work items not yet started"),
    blockers: z.array(z.string()).describe("Open blockers; never drop these"),
  }),
  state: z.object({
    decisions: z.array(z.string()).describe("Decisions made and why"),
    assumptions: z.array(z.string()),
    constraints: z
      .array(z.string())
      .describe("Constraints the user stated; keep wording exact"),
    rejectedApproaches: z
      .array(z.string())
      .describe("Approaches tried or considered and abandoned, with reason"),
  }),
  workspace: z.object({
    changedFiles: z
      .array(z.string())
      .describe("Files changed so far; exact paths that appear in the log"),
    relevantFiles: z
      .array(z.string())
      .describe("Files read or referenced that matter for remaining work"),
  }),
  evidence: z
    .array(
      z.object({
        kind: z.enum(["file", "commit", "test", "url", "tool_call", "other"]),
        ref: z.string().min(1),
        note: z.string(),
      })
    )
    .describe("Pointers to authoritative facts backing the claims above"),
  unresolvedQuestions: z.array(z.string()),
  continuity: z.object({
    nextAction: z
      .string()
      .min(1)
      .describe("The single next step, executable from this checkpoint alone"),
    warnings: z
      .array(z.string())
      .describe("Anything the continuing agent must not repeat or undo"),
  }),
});

export type AgentCheckpointBody = z.infer<typeof agentCheckpointSchema>;

export type AgentCheckpoint = AgentCheckpointBody & {
  provenance: {
    id: string;
    parentCheckpointId: string | null;
    createdAt: string;
    coveredMessageCount: number;
    compactorModel: string;
    schemaVersion: number;
  };
};

/**
 * Minimal message shape every surface can provide. Chat uses UIMessages
 * (`parts` arrays), the Slack runner uses `{ role, content }` — the helpers in
 * plan.ts read either.
 */
export type CompactableAgentMessage = {
  role: string;
  content?: unknown;
  parts?: unknown;
  id?: unknown;
};

export type CompactionValidation = {
  ok: boolean;
  failures: string[];
};

/** Payload persisted on the `ai_call_events` audit row. */
export type CompactionEventPayload = {
  kind: "compaction";
  checkpoint: AgentCheckpoint;
  handoff: string;
  prefixHash: string;
  coveredMessageCount: number;
  charsBefore: number;
  charsAfter: number;
  durationMs: number;
  validation: CompactionValidation;
};
