export const TEAM_ICONS_BUCKET = "team-icons";

// Resolve a stored icon_path to a public URL. We never persist the URL in the
// DB — computing it here from a trusted code path means the rendered <img src>
// can only ever point at our public icon bucket, removing the
// open-redirect/XSS class of bug that would exist if icon_url were a free-form
// column written by callers.
//
// Icons live in the storage_objects table and the app serves them itself under
// /storage/v1/object/public/*, so the URL is same-origin and relative. No
// admin client is involved, so this module is safe to import from anywhere.
// Filename segment must start with an alphanumeric character to reject
// dot-only names like ".." or "." that would otherwise pass the character
// class — HTTP clients or storage layers that normalize path segments could
// resolve those to the bucket root.
const TEAM_ICON_PATH_PATTERN = /^[A-Za-z0-9_-]+\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function teamIconUrlFromPath(iconPath: string | null): string | null {
  if (!iconPath) return null;
  if (!TEAM_ICON_PATH_PATTERN.test(iconPath)) return null;
  return `/storage/v1/object/public/${TEAM_ICONS_BUCKET}/${iconPath}`;
}
