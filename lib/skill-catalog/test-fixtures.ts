import { assignSkillSlugs } from "./slug";
import type { CatalogSkill, CatalogSkillRow } from "./types";

export function skillRow(
  name: string,
  overrides: Partial<CatalogSkillRow> = {}
): CatalogSkillRow {
  return {
    id: overrides.id ?? `id-${name.toLowerCase().replace(/\W+/g, "-")}`,
    name,
    description: null,
    content: `How to ${name}.`,
    tags: [],
    source: "library",
    ...overrides,
  };
}

export function catalogOf(...rows: CatalogSkillRow[]): CatalogSkill[] {
  return assignSkillSlugs(rows);
}
