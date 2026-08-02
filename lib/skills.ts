export type SkillScope = "global" | "project";

export const GLOBAL_SKILL_SCOPE: SkillScope = "global";

export const SKILL_SCOPE_LABELS = {
  global: "Global",
  project: "Project-specific",
} satisfies Record<SkillScope, string>;

export function formatSkillScope(scope: SkillScope) {
  return SKILL_SCOPE_LABELS[scope];
}
