import type { HarnessId } from "@/lib/harness/config";

const CODEX_SESSION_PATTERNS = [
  /\bsession id:\s*([\da-f-]{36})\b/i,
  /\bcodex session\s+([\da-f-]{36})\b/i,
];

function findStringField(value: unknown, field: string): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findStringField(item, field);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const direct = record[field];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  for (const nested of Object.values(record)) {
    const result = findStringField(nested, field);
    if (result) return result;
  }

  return null;
}

function extractClaudeSessionId(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    return findStringField(JSON.parse(trimmed), "session_id");
  } catch {
    return null;
  }
}

function extractCodexSessionId(line: string) {
  const trimmed = line.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        parsed.type === "thread.started" &&
        typeof parsed.thread_id === "string" &&
        parsed.thread_id.trim()
      ) {
        return parsed.thread_id.trim();
      }
    } catch {
      // Fall back to legacy human-readable session lines.
    }
  }

  for (const pattern of CODEX_SESSION_PATTERNS) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function createHarnessSessionParser(harnessId: HarnessId) {
  const buffers: Record<string, string> = {};
  let emittedSessionId: string | null = null;

  function nextSessionIdFromLine(line: string) {
    const candidate =
      harnessId === "claude-code"
        ? extractClaudeSessionId(line)
        : extractCodexSessionId(line);
    if (!candidate || candidate === emittedSessionId) return null;
    emittedSessionId = candidate;
    return candidate;
  }

  function parseBufferedLines(stream: string, flushRemainder = false) {
    const buffer = buffers[stream] ?? "";
    if (!buffer) return null;

    const lines = buffer.split("\n");
    buffers[stream] = flushRemainder ? "" : (lines.pop() ?? "");
    const completeLines = flushRemainder ? lines : lines;

    for (const line of completeLines) {
      const sessionId = nextSessionIdFromLine(line);
      if (sessionId) return sessionId;
    }

    return null;
  }

  return {
    push(stream: string, chunk: string) {
      buffers[stream] = (buffers[stream] ?? "") + chunk;
      return parseBufferedLines(stream);
    },
    flush() {
      for (const stream of Object.keys(buffers)) {
        const sessionId = parseBufferedLines(stream, true);
        if (sessionId) return sessionId;
      }
      return null;
    },
  };
}
