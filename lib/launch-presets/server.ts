import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  SANDBOX_LAUNCH_PRESET_MAX_PER_REPO,
  SandboxLaunchPresetValidationError,
  shouldRejectAtCap,
  type SandboxLaunchPreset,
  type SandboxLaunchPresetInput,
} from "@/lib/launch-presets/shared";

/**
 * Server-side CRUD for `sandbox_launch_presets`.
 *
 * `import "server-only"` at the top makes Next.js fail the build if a
 * client component ever transitively imports this module — defence
 * in depth against the supabaseAdmin (service role) initialiser
 * landing in the client bundle. Browser-safe pieces live in
 * `lib/launch-presets/shared.ts`.
 *
 * Follows the memories-client pattern: every query goes through
 * supabaseAdmin and explicitly filters by `user_id` (and `repo_id`)
 * for tenant isolation. The table's RLS policies are defence-in-depth
 * for any code path that reaches the table via end-user JWT clients.
 *
 * Preset model: literal capture of the launch dialog's
 * SandboxLaunchChoice at save time. Re-applying a preset reproduces
 * the exact path/branch/create-branch combination the user submitted,
 * regardless of how repo settings have evolved since.
 */

// Server-side CRUD only. Importers should pull validators / types /
// constants from `lib/launch-presets/shared.ts` directly so the
// import graph for browser code never traverses this server-only
// module. The previous shim re-export from here was removed once all
// callers were migrated; restore it here only if a server-side
// caller is found that genuinely needs both.

export async function listSandboxLaunchPresets(
  userId: string,
  repoId: string
): Promise<SandboxLaunchPreset[]> {
  const { data, error } = await supabaseAdmin
    .from("sandbox_launch_presets")
    .select("*")
    .eq("user_id", userId)
    .eq("repo_id", repoId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load launch presets: ${error.message}`);
  }

  return (data ?? []) as SandboxLaunchPreset[];
}

export async function upsertSandboxLaunchPreset(input: {
  userId: string;
  repoId: string;
  preset: SandboxLaunchPresetInput;
}): Promise<SandboxLaunchPreset> {
  // The cap check + upsert is intentionally non-atomic: a concurrent
  // request from the same user could land between the count() and the
  // INSERT and push the user one row over the cap. The cap is
  // advisory (UI guidance, not a security boundary) and a +1 over-cap
  // edge case is harmless. If we ever need true atomicity we'd need
  // a database trigger or partial unique index — both heavier than
  // the +1 case warrants today.
  const existing = await listSandboxLaunchPresets(input.userId, input.repoId);
  if (
    shouldRejectAtCap({
      newName: input.preset.name,
      existingPresetNames: existing.map((row) => row.name),
    })
  ) {
    throw new SandboxLaunchPresetValidationError(
      "name",
      `Preset cap reached (${SANDBOX_LAUNCH_PRESET_MAX_PER_REPO} per repo)`
    );
  }

  const payload = {
    user_id: input.userId,
    repo_id: input.repoId,
    name: input.preset.name,
    root_directory: input.preset.rootDirectory,
    base_branch: input.preset.baseBranch,
    working_branch: input.preset.workingBranch,
    create_branch: input.preset.createBranch,
  };

  const { data, error } = await supabaseAdmin
    .from("sandbox_launch_presets")
    .upsert(payload, {
      onConflict: "user_id,repo_id,name",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to save launch preset: ${error?.message ?? "unknown error"}`
    );
  }

  return data as SandboxLaunchPreset;
}

export async function deleteSandboxLaunchPreset(input: {
  userId: string;
  repoId: string;
  presetId: string;
}): Promise<{ deleted: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("sandbox_launch_presets")
    .delete()
    .eq("user_id", input.userId)
    .eq("repo_id", input.repoId)
    .eq("id", input.presetId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to delete launch preset: ${error.message}`);
  }

  return { deleted: Boolean(data) };
}
