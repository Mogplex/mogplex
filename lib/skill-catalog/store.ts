/**
 * Loads the skill catalog for a run: the acting user's library, minus the
 * skills the repo excludes, plus the skills the repo defines for itself.
 * Every function takes a client so tests can pass the PostgREST shim.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assignSkillSlugs } from "./slug";
import {
  EMPTY_SKILL_CATALOG,
  type CatalogSkillRow,
  type SkillCatalog,
} from "./types";

type Client = Pick<typeof supabaseAdmin, "from">;

const LIBRARY_LIMIT = 500;

type LibraryRow = {
  id: string;
  name: string;
  description: string | null;
  content: string | null;
  tags: string[] | null;
};

type OverrideRow = {
  id: string;
  skill_id: string | null;
  excluded: boolean | null;
  name: string | null;
  description: string | null;
  content: string | null;
};

export type LoadSkillCatalogInput = {
  userId: string;
  repoId?: string | null;
};

async function loadLibraryRows(userId: string, client: Client) {
  const { data, error } = await client
    .from("skills")
    .select("id, name, description, content, tags, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(LIBRARY_LIMIT);
  if (error) throw new Error(`Failed to load skills: ${error.message}`);
  return (data ?? []) as LibraryRow[];
}

async function loadOverrideRows(repoId: string, client: Client) {
  const { data, error } = await client
    .from("repo_skill_overrides")
    .select("id, skill_id, excluded, name, description, content, created_at")
    .eq("repo_id", repoId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`Failed to load repo skills: ${error.message}`);
  return (data ?? []) as OverrideRow[];
}

/**
 * Repo skills come first so a repo can shadow a library skill's plain slug.
 * Within each group the oldest skill keeps the plain slug, which keeps a
 * handle stable when a newer skill reuses the name.
 */
export function buildSkillCatalog(
  library: readonly LibraryRow[],
  overrides: readonly OverrideRow[]
): SkillCatalog {
  const excluded = new Set(
    overrides
      .filter((row) => row.excluded && row.skill_id)
      .map((row) => row.skill_id!)
  );
  const repoRows: CatalogSkillRow[] = overrides
    .filter((row) => !row.skill_id && row.name?.trim())
    .map((row) => ({
      id: row.id,
      name: row.name!.trim(),
      description: row.description,
      content: row.content ?? "",
      tags: [],
      source: "repo",
    }));
  const libraryRows: CatalogSkillRow[] = library
    .filter((row) => !excluded.has(row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      content: row.content ?? "",
      tags: row.tags ?? [],
      source: "library",
    }));
  return { skills: assignSkillSlugs([...repoRows, ...libraryRows]) };
}

export async function loadSkillCatalog(
  input: LoadSkillCatalogInput,
  client: Client = supabaseAdmin
): Promise<SkillCatalog> {
  const [library, overrides] = await Promise.all([
    loadLibraryRows(input.userId, client),
    input.repoId ? loadOverrideRows(input.repoId, client) : Promise.resolve([]),
  ]);
  return buildSkillCatalog(library, overrides);
}

/**
 * The catalog for a run that must start even when skills cannot load. Skills
 * add to a request; they never stand between a user and their run.
 */
export async function loadSkillCatalogOrEmpty(
  input: LoadSkillCatalogInput,
  client: Client = supabaseAdmin
): Promise<SkillCatalog> {
  try {
    return await loadSkillCatalog(input, client);
  } catch (error) {
    console.warn(
      "[skills] catalog unavailable:",
      error instanceof Error ? error.message : error
    );
    return EMPTY_SKILL_CATALOG;
  }
}
