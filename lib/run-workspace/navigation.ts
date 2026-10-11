import { scopedHref } from "@/lib/scoped-href";

export function runDeepLinkDestination(
  scope: string,
  runId: string,
  aiCallId: string,
  view?: string
) {
  return scopedHref(
    scope,
    view === "details"
      ? `/observability?call_id=${encodeURIComponent(aiCallId)}`
      : `/control?run=${encodeURIComponent(runId)}`
  );
}
