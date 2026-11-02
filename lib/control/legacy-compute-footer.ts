const ROUTINE_FOOTERS = new Set([
  "Compute: stopped automatically; no sandbox task remains running.",
  "Compute: still running because the preview remains available.",
  "Compute: still running because this is a persistent session.",
  "Compute: still running because follow-up work still needs it.",
  "Compute: still running because you asked to keep it running.",
]);

/** Old Control streams saved routine lifecycle footers as separate text parts.
 * Current state lives in sandbox controls; keep actual cleanup warnings visible.
 */
export function isLegacyRoutineComputeFooter(text: string) {
  return ROUTINE_FOOTERS.has(text.trim());
}
