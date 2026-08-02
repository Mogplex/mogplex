// Mirror of public.is_valid_scope_slug() from
// supabase/migrations/20260517190000_teams_rbac_phase_0.sql:
// 1-39 chars, [a-z0-9-], no leading/trailing/consecutive hyphens.
const SCOPE_SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

export function isValidScopeSlug(slug: string): boolean {
  return SCOPE_SLUG_RE.test(slug);
}

export function slugifyTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39)
    .replace(/-+$/g, "");
}
