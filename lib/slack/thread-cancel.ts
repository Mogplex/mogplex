/** Explicit control messages only; quoted commands and ordinary prose are input. */
export function parseSlackThreadCancel(payload: {
  threadTs: string;
  messageTs: string;
  text: string;
}): string | null {
  if (payload.threadTs === payload.messageTs) return null;
  const match = payload.text
    .trim()
    .match(/^(?:<@[A-Z0-9]+>\s+)?\/?mogplex-cancel(?:\s+(\S+))?$/i);
  return match ? (match[1] ?? "") : null;
}
