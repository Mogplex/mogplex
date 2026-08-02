import type { AiCall } from "@/lib/types";

export type ActivitySurface = "live" | "cli" | "cloud" | "automation";

export function deriveSurface(call: AiCall): ActivitySurface {
  if (call.status === "pending" || call.status === "streaming") return "live";
  if (call.job_run_id) return "automation";
  if (call.runtime_command_id) return "cli";
  // CLI inference (the local TUI / OpenAI-compat shim) records calls without
  // a runtime_command_id but stamps metadata.source = "cli". Without this
  // check those rows would render as "Cloud" in the observability dashboard.
  if (call.metadata?.source === "cli") return "cli";
  return "cloud";
}

export function formatCostUsd(cost: number | null | undefined): string {
  if (cost == null) return "—";
  if (cost === 0) return "$0.00";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

export const SURFACE_LABELS: Record<ActivitySurface, string> = {
  live: "Live",
  cli: "CLI",
  cloud: "Cloud",
  automation: "Auto",
};

export const SURFACE_FILTER_OPTIONS = [
  { label: "All", value: "" },
  { label: "Live", value: "live" },
  { label: "CLI", value: "cli" },
  { label: "Cloud", value: "cloud" },
  { label: "Automation", value: "automation" },
] as const;
