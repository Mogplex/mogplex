/** Up to two initials for a team or account without an icon. */
export function scopeInitials(label: string): string {
  // Spread into code points so an emoji is never split into half a glyph.
  const parts = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => [...part]);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).join("").toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
