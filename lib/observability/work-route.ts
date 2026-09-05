import type { JobsFilters } from "@/hooks/use-observability";

export type WorkView = "runs" | "attention" | "events" | "usage";
export function readWorkView(params: URLSearchParams): WorkView {
  const value = params.get("view");
  if (
    value === "attention" ||
    value === "events" ||
    value === "usage" ||
    value === "runs"
  )
    return value;
  return params.has("call_id") ||
    params.has("sandbox_record_id") ||
    params.has("repo_id")
    ? "usage"
    : "runs";
}

export function readWorkFilters(params: URLSearchParams): JobsFilters {
  const page = Number(params.get("run_page") ?? 1);
  const status = params.get("run_status");
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    limit: 25,
    sort: "created_at",
    order: "desc",
    status:
      status &&
      [
        "pending",
        "running",
        "awaiting_input",
        "success",
        "failed",
        "cancelled",
      ].includes(status)
        ? status
        : undefined,
    sourceKind: params.get("run_source") || undefined,
    onlyRepairable: params.get("repairable") === "true" || undefined,
  };
}

export function writeWorkFilters(
  params: URLSearchParams,
  filters: JobsFilters
) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries({
    run_page: filters.page === 1 ? undefined : String(filters.page),
    run_status: filters.status,
    run_source: filters.sourceKind,
    repairable: filters.onlyRepairable ? "true" : undefined,
  })) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}
