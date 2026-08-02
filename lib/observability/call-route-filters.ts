type SearchParamsLike = {
  get: (name: string) => string | null;
  toString: () => string;
};

export type ObservabilityCallRouteFilters = {
  repoId?: string;
  sandboxRecordId?: string;
  callId?: string;
};

function normalizeOptionalQueryValue(value: string | null) {
  if (!value) return;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function readObservabilityCallRouteFilters(
  searchParams: SearchParamsLike
): ObservabilityCallRouteFilters {
  return {
    repoId: normalizeOptionalQueryValue(searchParams.get("repo_id")),
    sandboxRecordId: normalizeOptionalQueryValue(
      searchParams.get("sandbox_record_id")
    ),
    callId: normalizeOptionalQueryValue(searchParams.get("call_id")),
  };
}

export function mergeObservabilityCallRouteFilters<
  T extends {
    repoId?: string;
    sandboxRecordId?: string;
    callId?: string;
    page: number;
  },
>(prev: T, routeFilters: ObservabilityCallRouteFilters): T {
  const repoFilterChanged = prev.repoId !== routeFilters.repoId;
  const sandboxFilterChanged =
    prev.sandboxRecordId !== routeFilters.sandboxRecordId;
  const callFilterChanged = prev.callId !== routeFilters.callId;

  if (!repoFilterChanged && !sandboxFilterChanged && !callFilterChanged) {
    return prev;
  }

  return {
    ...prev,
    repoId: routeFilters.repoId,
    sandboxRecordId: routeFilters.sandboxRecordId,
    callId: routeFilters.callId,
    page: repoFilterChanged || sandboxFilterChanged ? 1 : prev.page,
  };
}

function buildObservabilityHref(params: URLSearchParams) {
  const nextQuery = params.toString();
  return nextQuery ? `/observability?${nextQuery}` : "/observability";
}

export function buildCurrentObservabilityCallHref(
  searchParams: SearchParamsLike
) {
  const params = new URLSearchParams(searchParams.toString());
  return buildObservabilityHref(params);
}

export function buildClearedRepoCallFilterHref(searchParams: SearchParamsLike) {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("repo_id");
  return buildObservabilityHref(params);
}

export function buildClearedSandboxCallFilterHref(
  searchParams: SearchParamsLike
) {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("sandbox_record_id");
  return buildObservabilityHref(params);
}

export function buildSelectedCallFilterHref(
  searchParams: SearchParamsLike,
  callId: string
) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("call_id", callId);
  return buildObservabilityHref(params);
}

export function buildClearedCallFilterHref(searchParams: SearchParamsLike) {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("call_id");
  return buildObservabilityHref(params);
}
