/**
 * Counts a skill as used when it reaches a run: a user invoked it by name, or
 * an agent loaded it. Best effort by design. A count must never delay or fail
 * the run it describes, so this swallows every error.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";
import type { CatalogSkill } from "./types";

type Client = Pick<typeof supabaseAdmin, "rpc">;

export type RecordSkillUse = (
  userId: string,
  skills: readonly Pick<CatalogSkill, "id" | "source">[]
) => Promise<void>;

/** Repo-defined skills live in override rows, which carry no counter. */
export function countableSkillIds(
  skills: readonly Pick<CatalogSkill, "id" | "source">[]
): string[] {
  return [
    ...new Set(
      skills
        .filter((skill) => skill.source === "library" && isUuid(skill.id))
        .map((skill) => skill.id)
    ),
  ];
}

export async function recordSkillUse(
  userId: string,
  skills: readonly Pick<CatalogSkill, "id" | "source">[],
  client: Client = supabaseAdmin
): Promise<void> {
  try {
    const ids = countableSkillIds(skills);
    if (ids.length === 0 || !isUuid(userId)) return;
    const { error } = await client.rpc("increment_skill_usage", {
      p_user_id: userId,
      p_skill_ids: ids,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.warn(
      "[skills] usage not recorded:",
      error instanceof Error ? error.message : error
    );
  }
}
