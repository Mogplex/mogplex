import type { Connection } from "@/lib/types";

export type McpStatusSummary = {
  label: string;
  /** Tailwind bg-* class for the indicator dot */
  dot: string;
  /** Semantic state driving the dot color */
  state: "empty" | "none-enabled" | "all-healthy" | "partial" | "failing";
};

/**
 * Reduce a list of MCP-type connections to a single status pill summary.
 *
 * - "failing" if any enabled server is unreachable / error / auth_failed (red)
 * - "all-healthy" if every enabled server is healthy (green)
 * - "partial" if enabled servers mix healthy with pending/unknown (amber)
 * - "none-enabled" / "empty" when nothing to show (muted)
 */
export function summarizeMcpStatus(servers: Connection[]): McpStatusSummary {
  if (servers.length === 0) {
    return { label: "Tools: 0", dot: "bg-muted-foreground/50", state: "empty" };
  }

  const enabled = servers.filter((s) => s.is_enabled);
  if (enabled.length === 0) {
    return {
      label: `Tools: 0/${servers.length}`,
      dot: "bg-muted-foreground/50",
      state: "none-enabled",
    };
  }

  const healthy = enabled.filter((s) => s.health_status === "healthy").length;
  const failing = enabled.some(
    (s) =>
      s.health_status === "unreachable" ||
      s.health_status === "error" ||
      s.health_status === "auth_failed"
  );

  const label = `Tools: ${healthy}/${enabled.length}`;
  if (failing) return { label, dot: "bg-red-500", state: "failing" };
  if (healthy === enabled.length)
    return { label, dot: "bg-green-500", state: "all-healthy" };
  return { label, dot: "bg-amber-400", state: "partial" };
}
