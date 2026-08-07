import type { PreviewOverlayStatus } from "@/lib/sandbox/preview-overlay-status";
import type { SelectionRect } from "./types";

export function formatPreviewToolbarStatus(status: PreviewOverlayStatus) {
  switch (status) {
    case "starting":
      return "Starting...";
    case "building":
      return "Building";
    case "pausing":
      return "Pausing";
    case "stopped":
      return "Stopped";
    case "paused":
      return "Paused";
    case "build_failed":
      return "Build failed";
    case "deployment_missing":
      return "Deployment issue";
    case "app_error":
      return "App error";
    case "unreachable":
      return "Unreachable";
    case "idle_warning":
      // The runtime remains reachable and interactive in this state; the
      // separate lifecycle controls own pause/resume messaging. Do not present
      // a healthy preview as degraded merely because it is idle.
      return "Ready";
    case "error":
      return "Error";
    default:
      return "No preview";
  }
}

export function parseEnvText(input: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const raw of input.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = raw.indexOf("=");
    if (sep <= 0) return null;
    const key = raw.slice(0, sep).trim();
    if (!key) return null;
    const rawVal = raw.slice(sep + 1);
    const val =
      rawVal.match(/^"(.*)"$/)?.[1] ?? rawVal.match(/^'(.*)'$/)?.[1] ?? rawVal;
    result[key] = val;
  }
  if (Object.keys(result).length === 0) return null;
  return result;
}

export function describeRegion(r: SelectionRect): string {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const vPos = cy < 33 ? "top" : cy > 66 ? "bottom" : "middle";
  const hPos = cx < 33 ? "left" : cx > 66 ? "right" : "center";
  if (vPos === "middle" && hPos === "center") return "center area";
  if (hPos === "center") return `${vPos} area`;
  if (vPos === "middle") return `${hPos} side`;
  return `${vPos}-${hPos} area`;
}
