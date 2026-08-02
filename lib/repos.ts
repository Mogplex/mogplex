import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  applyResourceOwnerScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
import { isUuid } from "@/lib/uuid";

export { UUID_RE, isUuid } from "@/lib/uuid";

export const REPO_SELECT_WITH_WORKSPACE =
  "*, workspace:workspaces(id, user_id, owner_type, owner_user_id, product_team_id, created_by_user_id, name, description, is_default, sandbox_billing_mode, sandbox_timeout_ms, sandbox_vercel_team_id, sandbox_vercel_project_id, vercel_link_status, vercel_link_checked_at, vercel_link_error_code, vercel_link_message, created_at, updated_at)";

export const isRepoId = isUuid;

export async function getOwnedRepo<T = { id: string }>(
  repoId: string,
  userId: string,
  select = "id"
): Promise<T | null> {
  if (!isRepoId(repoId)) return null;

  const { data, error } = await supabaseAdmin
    .from("repos")
    .select(select)
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load repo ${repoId}: ${error.message}`);
  }

  return (data as T | null) ?? null;
}

export async function getRepoForScope<T = { id: string }>(
  repoId: string,
  scope: ProductResourceScope,
  select = "id"
): Promise<T | null> {
  if (!isRepoId(repoId)) return null;

  let query = supabaseAdmin.from("repos").select(select).eq("id", repoId);
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Failed to load repo ${repoId}: ${error.message}`);
  }

  return (data as T | null) ?? null;
}
