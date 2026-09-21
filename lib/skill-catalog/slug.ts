import type { CatalogSkill, CatalogSkillRow } from "./types";

const FALLBACK_SLUG = "skill";

/** `Deploy Checklist (v2)` becomes `deploy-checklist-v2`. */
export function slugifySkillName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\da-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || FALLBACK_SLUG;
}

/**
 * Gives every row a slug that is unique within the catalog. Rows keep their
 * order, and the first row to claim a slug keeps it bare, so a repo skill
 * listed ahead of a library skill with the same name wins the plain handle.
 */
export function assignSkillSlugs(
  rows: readonly CatalogSkillRow[]
): CatalogSkill[] {
  const taken = new Set<string>();
  return rows.map((row) => {
    const base = slugifySkillName(row.name);
    let slug = base;
    let suffix = 2;
    while (taken.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    taken.add(slug);
    return { ...row, slug };
  });
}
