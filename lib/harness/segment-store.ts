import type {
  LocalMessageSegment,
  LocalToolCall,
} from "@/hooks/use-conversations";

export type HarnessRenderChunk = {
  text: string;
  toolCalls?: LocalToolCall[];
  segments?: LocalMessageSegment[];
};

// Invariant: segments is append-only within a run — entries are pushed or
// mutated in place, never removed or reordered. toolCallIndex stores positions
// into segments, so any future code that splices/removes segments must also
// rebuild this map, or the indices will dangle.
export type SegmentStore = {
  segments: LocalMessageSegment[];
  toolCallIndex: Map<string, number>;
  dirty: boolean;
  pendingTextDelta: string;
};

export function createSegmentStore(): SegmentStore {
  return {
    segments: [],
    toolCallIndex: new Map(),
    dirty: false,
    pendingTextDelta: "",
  };
}

export function appendText(
  store: SegmentStore,
  text: string,
  kind: "text" | "status"
): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const last = store.segments.at(-1);
  const prefix = last ? (kind === "text" ? "\n\n" : "\n") : "";
  const chunk = `${prefix}${normalized}`;

  if (last?.type === "text") {
    last.text += chunk;
  } else {
    store.segments.push({ type: "text", text: chunk });
  }
  store.dirty = true;
  store.pendingTextDelta += chunk;
  return chunk;
}

export function upsertToolCall(store: SegmentStore, toolCall: LocalToolCall) {
  const existingIndex = store.toolCallIndex.get(toolCall.id);
  if (existingIndex !== undefined) {
    const existing = store.segments[existingIndex];
    if (existing?.type === "tool-call") {
      store.segments[existingIndex] = { type: "tool-call", toolCall };
      store.dirty = true;
      return;
    }
  }
  store.segments.push({ type: "tool-call", toolCall });
  store.toolCallIndex.set(toolCall.id, store.segments.length - 1);
  store.dirty = true;
}

export function updateToolCall(
  store: SegmentStore,
  id: string,
  patch: Partial<LocalToolCall>
) {
  const existingIndex = store.toolCallIndex.get(id);
  if (existingIndex === undefined) return;
  const existing = store.segments[existingIndex];
  if (existing?.type !== "tool-call") return;
  store.segments[existingIndex] = {
    type: "tool-call",
    toolCall: { ...existing.toolCall, ...patch },
  };
  store.dirty = true;
}

export function snapshot(store: SegmentStore): HarnessRenderChunk {
  const textDelta = store.pendingTextDelta;
  store.pendingTextDelta = "";

  if (!store.dirty) return { text: textDelta };
  store.dirty = false;

  const segments: LocalMessageSegment[] = store.segments.map((segment) =>
    segment.type === "text"
      ? { type: "text", text: segment.text }
      : { type: "tool-call", toolCall: { ...segment.toolCall } }
  );

  const toolCalls = segments
    .filter(
      (segment): segment is { type: "tool-call"; toolCall: LocalToolCall } =>
        segment.type === "tool-call"
    )
    .map((segment) => segment.toolCall);

  return {
    text: textDelta,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    segments,
  };
}
