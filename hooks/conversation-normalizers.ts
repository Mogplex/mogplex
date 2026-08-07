import type {
  HarnessSessionState,
  HarnessState,
  LocalMessage,
  LocalMessageSegment,
  LocalToolCall,
  LocalToolCallState,
} from "./conversation-types";

export function normalizeLocalToolCall(value: unknown): LocalToolCall | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string")
    return null;

  const { state } = record;
  const normalizedState: LocalToolCallState =
    state === "done" || state === "error" || state === "denied"
      ? state
      : "running";

  return {
    id: record.id,
    name: record.name,
    input: record.input,
    output: record.output,
    state: normalizedState,
  };
}

export function normalizeLocalMessageSegment(
  value: unknown
): LocalMessageSegment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type === "text") {
    return {
      type: "text",
      text: typeof record.text === "string" ? record.text : "",
    };
  }
  if (record.type === "tool-call") {
    const toolCall = normalizeLocalToolCall(record.toolCall);
    if (!toolCall) return null;
    return { type: "tool-call", toolCall };
  }
  return null;
}

export function normalizeLocalMessage(value: unknown): LocalMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;

  const toolCalls = Array.isArray(record.toolCalls)
    ? record.toolCalls
        .map(normalizeLocalToolCall)
        .filter((toolCall): toolCall is LocalToolCall => toolCall !== null)
    : undefined;

  const segments = Array.isArray(record.segments)
    ? record.segments
        .map(normalizeLocalMessageSegment)
        .filter((segment): segment is LocalMessageSegment => segment !== null)
    : undefined;

  return {
    id: record.id,
    text: typeof record.text === "string" ? record.text : "",
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(segments && segments.length > 0 ? { segments } : {}),
  };
}

export function normalizeLocalMessages(value: unknown): LocalMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(Boolean)
    .map(normalizeLocalMessage)
    .filter((message): message is LocalMessage => message !== null);
}

export function normalizeHarnessSessionState(
  value: unknown
): HarnessSessionState | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || !record.sessionId.trim())
    return null;

  return {
    sessionId: record.sessionId.trim(),
    sandboxId:
      typeof record.sandboxId === "string"
        ? record.sandboxId.trim() || null
        : null,
  };
}

export function normalizeHarnessState(value: unknown): HarnessState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: HarnessState = {};
  for (const harnessId of ["claude-code", "codex"] as const) {
    const session = normalizeHarnessSessionState(
      (value as Record<string, unknown>)[harnessId]
    );
    if (session) {
      normalized[harnessId] = session;
    }
  }

  return normalized;
}
