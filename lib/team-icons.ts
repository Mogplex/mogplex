export const TEAM_ICONS_BUCKET = "team-icons";

// Resolve a stored icon_path to a public URL. We never persist the URL in the
// DB — computing it here from a trusted code path means the rendered <img src>
// can only ever point at our Supabase Storage bucket, removing the
// open-redirect/XSS class of bug that would exist if icon_url were a free-form
// column written by callers.
//
// Built from env-only Supabase URL — no admin client — so this module is safe
// to import from anywhere without risking the service-role key landing in a
// client bundle.
//
// Prefers NEXT_PUBLIC_SUPABASE_URL because the result is rendered as an
// <img src> in the browser; SUPABASE_URL is only used as a fallback for
// server-side deployments that don't set the public var (unlike
// lib/supabase/admin.ts, which prefers SUPABASE_URL for its server-to-server
// admin client where an internal hostname is preferable).
// Filename segment must start with an alphanumeric character to reject
// dot-only names like ".." or "." that would otherwise pass the character
// class — HTTP clients or storage layers that normalize path segments could
// resolve those to the bucket root.
const TEAM_ICON_PATH_PATTERN = /^[A-Za-z0-9_-]+\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function teamIconUrlFromPath(iconPath: string | null): string | null {
  if (!iconPath) return null;
  if (!TEAM_ICON_PATH_PATTERN.test(iconPath)) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${TEAM_ICONS_BUCKET}/${iconPath}`;
}
