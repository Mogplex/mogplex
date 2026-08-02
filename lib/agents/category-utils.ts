export const MAX_AGENT_CATEGORY_LABEL_LENGTH = 40;
export const MAX_AGENT_CATEGORY_SLUG_LENGTH = 40;
export const AGENT_CATEGORY_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function normalizeCategoryLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

export function slugifyCategoryLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_AGENT_CATEGORY_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
}

export function isValidCategorySlug(value: unknown): value is string {
  return typeof value === "string" && AGENT_CATEGORY_SLUG_PATTERN.test(value);
}

// Returns a slug that is not in `taken`, trying `baseSlug` first and then
// `${base}-2`...`${base}-{maxAttempt}` while keeping the result within the
// validation pattern (no trailing hyphens, ≤ MAX_AGENT_CATEGORY_SLUG_LENGTH).
// Returns null if all attempts collide.
export function dedupeCategorySlug(
  baseSlug: string,
  taken: ReadonlySet<string>,
  maxAttempt = 20
): string | null {
  if (!taken.has(baseSlug)) return baseSlug;
  for (let i = 2; i <= maxAttempt; i++) {
    const suffix = `-${i}`;
    const maxBase = MAX_AGENT_CATEGORY_SLUG_LENGTH - suffix.length;
    const truncatedBase = baseSlug.slice(0, maxBase).replace(/-+$/, "");
    if (truncatedBase.length === 0) return null;
    const candidate = `${truncatedBase}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}
