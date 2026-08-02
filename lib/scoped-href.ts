export function scopedHref(scope: string | undefined, path: string): string {
  if (!scope) {
    throw new Error(
      `scopedHref: scope is required (path=${path}). ` +
        "Called outside a [scope] route segment — useParams() returned no scope."
    );
  }
  return `/${scope}${path.startsWith("/") ? path : `/${path}`}`;
}
