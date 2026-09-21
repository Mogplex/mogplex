/**
 * Loads the skill catalog for a run: the acting user's library, minus the
 * skills the repo excludes, plus the skills the repo defines for itself.
 * Repo overrides apply only when the acting user owns the repo.
 * Every function takes a client so tests can pass the PostgREST shim.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";
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

/**
 * A repo's overrides belong to the repo's owner, the same rule the settings
 * panel enforces. Callers pass repo ids straight from a request, so this is
 * the check that keeps one person's repo skills out of another's prompt.
 */
async function isRepoOwner(repoId: string, userId: string, client: Client) {
  const { data, error } = await client
    .from("repos")
    .select("id")
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load repo: ${error.message}`);
  return Boolean(data);
}

async function loadOwnedOverrideRows(
  input: LoadSkillCatalogInput,
  client: Client
): Promise<OverrideRow[]> {
  if (!input.repoId || !isUuid(input.repoId)) return [];
  const [owned, overrides] = await Promise.all([
    isRepoOwner(input.repoId, input.userId, client),
    loadOverrideRows(input.repoId, client),
  ]);
  return owned ? overrides : [];
}

export async function loadSkillCatalog(
  input: LoadSkillCatalogInput,
  client: Client = supabaseAdmin
): Promise<SkillCatalog> {
  const [library, overrides] = await Promise.all([
    loadLibraryRows(input.userId, client),
    loadOwnedOverrideRows(input, client),
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
