import type { Connection, ConnectionApprovalMode } from "@/lib/types";

/** Badge on a connection whose tools wait for the user. */
export const APPROVAL_ASK_BADGE = "asks first";

/** What `ask` means in practice, shown wherever the setting can be changed. */
export const APPROVAL_ASK_HINT =
  "Control asks you before each call. Chat, Slack, and API runs cannot ask, so they skip this connection.";

export function asksBeforeRunning(
  conn: Pick<Connection, "approval_mode">
): boolean {
  return conn.approval_mode === "ask";
}

export function nextApprovalMode(
  mode: ConnectionApprovalMode
): ConnectionApprovalMode {
  return mode === "ask" ? "auto" : "ask";
}

/** Label for the control that switches a connection to the other mode. */
export function getApprovalModeActionLabel(
  mode: ConnectionApprovalMode
): string {
  return mode === "ask"
    ? "Run tools without asking"
    : "Ask before running tools";
}
