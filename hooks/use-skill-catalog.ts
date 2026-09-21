"use client";
import { useMemo } from "react";
import useSWR from "swr";
import type { SkillCatalogEntry } from "@/app/api/skills/catalog/route";
import type { SlashCommand } from "@/lib/slash-command-types";
import { isUuid } from "@/lib/uuid";

const EMPTY: SkillCatalogEntry[] = [];

async function fetchCatalog(url: string): Promise<SkillCatalogEntry[]> {
  const res = await fetch(url);
  if (!res.ok) return EMPTY;
  const body = (await res.json()) as { skills?: SkillCatalogEntry[] };
  return body.skills ?? EMPTY;
}

/**
 * A repo id narrows the catalog only when it is a real one. Pickers also hold
 * placeholders ("new project"), and the library alone is the right answer then.
 */
export function skillCatalogKey(repoId?: string | null) {
  return repoId && isUuid(repoId)
    ? `/api/skills/catalog?repoId=${encodeURIComponent(repoId)}`
    : "/api/skills/catalog";
}

/**
 * The signed-in user's skills with the slug each answers to, narrowed by the
 * repo when one is open. A failed load is an empty list: completion is a
 * convenience, and the server resolves the handle either way.
 */
export function useSkillCatalog(repoId?: string | null) {
  const { data = EMPTY, mutate } = useSWR(
    skillCatalogKey(repoId),
    fetchCatalog
  );
  return { skills: data, mutate };
}

/**
 * Skills as slash commands, so `/` completion lists them beside the
 * built-ins. Running one does nothing locally: the `skill` action tells the
 * composer to send the message as typed, and the server loads the skill.
 */
export function useSkillSlashCommands(repoId?: string | null): SlashCommand[] {
  const { skills } = useSkillCatalog(repoId);
  return useMemo(
    () =>
      skills.map((skill) => ({
        name: skill.slug,
        description: skill.description?.trim() || `Skill: ${skill.name}`,
        args: "[request]",
        execute: () => ({ output: "", action: "skill" as const }),
      })),
    [skills]
  );
}
