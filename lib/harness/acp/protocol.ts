/**
 * The JSON lines `ACP_BRIDGE_SCRIPT` prints on stdout. `update` carries an
 * ACP `session/update` payload unchanged; the rest are the bridge's own.
 */
export type AcpBridgeEvent =
  | { type: "start" }
  | {
      type: "initialize";
      agentInfo: { name?: string; version?: string } | null;
    }
  | { type: "session"; sessionId: string }
  | { type: "resume_failed"; sessionId: string; message: string }
  | { type: "update"; update: AcpSessionUpdate }
  | {
      type: "permission";
      toolCall: AcpToolCallFields | null;
      policy: "allow" | "decline";
      outcome: string;
      optionName: string | null;
    }
  | { type: "continued"; reason: "declined" }
  | { type: "done"; stopReason: string | null; usage: unknown }
  | { type: "error"; message: string };

export type AcpToolCallFields = {
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  content?: unknown[];
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: unknown[];
  _meta?: Record<string, unknown>;
};

export type AcpSessionUpdate = Omit<AcpToolCallFields, "content"> & {
  sessionUpdate?: string;
  messageId?: string;
  content?: unknown;
  entries?: unknown[];
};

const BRIDGE_TAG = '"mogplex_acp"';

/** The bridge event on one stdout line, or null for anything else. */
export function parseAcpBridgeLine(line: string): AcpBridgeEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes(BRIDGE_TAG)) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      mogplex_acp?: unknown;
      type?: unknown;
    };
    return parsed.mogplex_acp === 1 && typeof parsed.type === "string"
      ? (parsed as AcpBridgeEvent)
      : null;
  } catch {
    return null;
  }
}
