export type StatTone = "success" | "warn" | "failure";

export const STAT_TONE_CLASSES: Record<StatTone, string> = {
  success: "border-[var(--accent-green)]/20 bg-[var(--accent-green)]/5",
  warn: "border-[var(--accent-amber)]/20 bg-[var(--accent-amber)]/5",
  failure: "border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5",
};

export const STAT_TONE_VALUE_CLASSES: Record<StatTone, string> = {
  success: "text-[var(--accent-green)]",
  warn: "text-[var(--accent-amber)]",
  failure: "text-[var(--accent-red)]",
};

export function successTone(rate: number): StatTone {
  if (rate >= 95) return "success";
  if (rate >= 80) return "warn";
  return "failure";
}
