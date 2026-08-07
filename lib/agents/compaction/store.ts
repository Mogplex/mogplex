import { sanitizeTelemetryRecord } from "@/lib/ai-telemetry";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  COMPACTION_EVENT_MESSAGE,
  COMPACTION_FAILED_EVENT_MESSAGE,
  type AgentCheckpoint,
  type CompactionEventPayload,
} from "./types";
import type { StoredCompaction } from "./index";

/**
 * Audit persistence for compaction checkpoints, backed by `ai_call_events`.
 * Each compaction appends an immutable `log` row; the newest row for a
 * conversation is the reuse candidate for the next turn. Nothing here is
 * user-visible — the observability surface reads these rows directly.
 */

// Checkpoints nest deeper and render longer than typical telemetry payloads;
// keep secret redaction but lift the structural caps so the stored handoff
// stays byte-identical to what the model was given.
const SANITIZE_OPTIONS = {
  maxStringLength: 120_000,
  maxItems: 200,
  maxDepth: 8,
};

export async function persistCompactionEvent(input: {
  aiCallId: string;
  userId: string;
  conversationId: string | null;
  repoId?: string | null;
  payload: CompactionEventPayload;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("ai_call_events").insert({
    ai_call_id: input.aiCallId,
    user_id: input.userId,
    conversation_id: input.conversationId,
    repo_id: input.repoId ?? null,
    event_type: "log",
    tool_name: null,
    message: input.payload.validation.ok
      ? COMPACTION_EVENT_MESSAGE
      : COMPACTION_FAILED_EVENT_MESSAGE,
    payload: sanitizeTelemetryRecord(
      input.payload as unknown as Record<string, unknown>,
      SANITIZE_OPTIONS
    ),
  });
  if (error) {
    // Compaction stays useful for the current run even if the audit row
    // fails; the next turn simply recompacts instead of reusing.
    console.error("[compaction] failed to persist checkpoint event", error);
  }
}

function parseStoredCompaction(payload: unknown): StoredCompaction | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.kind !== "compaction") return null;
  const checkpoint = record.checkpoint as AgentCheckpoint | undefined;
  if (
    !checkpoint ||
    typeof checkpoint !== "object" ||
    typeof checkpoint.provenance?.id !== "string" ||
    typeof record.handoff !== "string" ||
    typeof record.prefixHash !== "string" ||
    typeof record.coveredMessageCount !== "number"
  ) {
    return null;
  }
  const validation = record.validation as { ok?: unknown } | undefined;
  if (validation?.ok !== true) return null;
  return {
    checkpoint,
    handoff: record.handoff,
    prefixHash: record.prefixHash,
    coveredMessageCount: record.coveredMessageCount,
  };
}

export async function loadLatestCompaction(input: {
  userId: string;
  conversationId: string;
}): Promise<StoredCompaction | null> {
  const { data, error } = await supabaseAdmin
    .from("ai_call_events")
    .select("payload")
    .eq("user_id", input.userId)
    .eq("conversation_id", input.conversationId)
    .eq("event_type", "log")
    .eq("message", COMPACTION_EVENT_MESSAGE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[compaction] failed to load checkpoint event", error);
    return null;
  }
  return parseStoredCompaction(data?.payload ?? null);
}
