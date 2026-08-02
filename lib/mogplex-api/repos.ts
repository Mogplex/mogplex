import { supabaseAdmin } from "@/lib/supabase/admin";

export type MogplexApiRepo = {
  id: string;
  full_name: string;
  installation_id: number;
  default_branch: string | null;
  root_directory: string | null;
};

export type ListMogplexApiReposOptions = {
  query?: string | null;
  id?: string | null;
  limit?: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listMogplexApiRepos(
  userId: string,
  options: ListMogplexApiReposOptions = {}
): Promise<MogplexApiRepo[]> {
  // Repo ids are UUIDs; a non-UUID selector can never match, and passing it
  // to Postgres would fail the uuid cast instead of returning an empty list.
  if (options.id != null && !UUID_PATTERN.test(options.id)) {
    return [];
  }

  let query = supabaseAdmin
    .from("repos")
    .select(
      "id, full_name, github_installation_id, default_branch, root_directory"
    )
    .eq("user_id", userId)
    .or("is_hidden.is.null,is_hidden.eq.false")
    .order("full_name", { ascending: true })
    .limit(options.limit ?? 100);

  if (options.id != null) {
    query = query.eq("id", options.id);
  } else if (options.query) {
    query = query.ilike("full_name", `%${options.query}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((repo) => ({
    id: repo.id,
    full_name: repo.full_name,
    installation_id: repo.github_installation_id,
    default_branch: repo.default_branch,
    root_directory: repo.root_directory,
  })) as MogplexApiRepo[];
}
