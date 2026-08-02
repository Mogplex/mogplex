import type { Flow, TriggerEvent } from "@/lib/types";

export type FlowTriggerSourceKind = Flow["source_kind"];

export function flowTriggerSourceKind(
  event: TriggerEvent
): FlowTriggerSourceKind {
  switch (event) {
    case "schedule":
      return "schedule";
    case "webhook":
      return "webhook";
    case "slack_mention":
      return "slack";
    default:
      return "github";
  }
}
