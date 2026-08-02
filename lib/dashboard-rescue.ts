// First path segments that live under a [scope] route. When an authed user
// lands on `/<segment>/...` without a scope prefix — a stale link, a typo,
// or (historically) a sub-nav that forgot to call `scopedHref` — the proxy
// redirects to `/<user-slug>/<segment>/...` instead of 404-ing.
//
// Keep in sync with the directory layout under `app/(dashboard)/[scope]/`.
// Adding a new top-level scoped section here ensures it gets rescued too.
export const DASHBOARD_SCOPED_FIRST_SEGMENTS: ReadonlySet<string> = new Set([
  "agents",
  "assignments",
  "automations",
  "flows",
  "library",
  "observability",
  "primitives",
  "projects",
  "runs",
  "settings",
  "triggers",
  "workflows",
]);

export function isDashboardScopedFirstSegment(segment: string): boolean {
  // Match `isReservedSlug`'s case-insensitive behaviour: `RESERVED_SLUGS`
  // folds these segments in and lowercases on lookup, so `/Agents/skills`
  // resolves to `not_found` and must also pass the rescue check.
  return DASHBOARD_SCOPED_FIRST_SEGMENTS.has(segment.toLowerCase());
}
