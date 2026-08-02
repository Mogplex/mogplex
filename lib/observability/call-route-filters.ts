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

// basePath defaults to the unscoped path for backward compatibility, but
// callers inside the scoped dashboard must pass the current pathname (e.g.
// "/alex/observability"): the bare "/observability" only works because
// proxy.ts rescue-redirects it back into the scope, costing a redirect hop —
// and routes that skip the proxy (like the e2e auth bypass) resolve it as a
// scope slug instead.
function buildObservabilityHref(
  params: URLSearchParams,
  basePath = "/observability"
) {
  const nextQuery = params.toString();
  return nextQuery ? `${basePath}?${nextQuery}` : basePath;
}

export function buildCurrentObservabilityCallHref(
  searchParams: SearchParamsLike,
  basePath?: string
) {
  const params = new URLSearchParams(searchParams.toString());
  return buildObservabilityHref(params, basePath);
}

export function buildClearedRepoCallFilterHref(
  searchParams: SearchParamsLike,
  basePath?: string
) {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("repo_id");
  return buildObservabilityHref(params, basePath);
}

export function buildClearedSandboxCallFilterHref(
  searchParams: SearchParamsLike,
  basePath?: string
) {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("sandbox_record_id");
  return buildObservabilityHref(params, basePath);
}

export function buildSelectedCallFilterHref(
  searchParams: SearchParamsLike,
  callId: string,
  basePath?: string
) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("call_id", callId);
  return buildObservabilityHref(params, basePath);
}

export function buildClearedCallFilterHref(
  searchParams: SearchParamsLike,
  basePath?: string
) {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("call_id");
  return buildObservabilityHref(params, basePath);
}
