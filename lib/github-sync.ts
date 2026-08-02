import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchGithubInstallationRepos,
  hasGithubAppConfig,
} from "@/lib/github-app";
import { ensureDefaultWorkspaceForUser } from "@/lib/workspaces";
import {
  applyResourceOwnerScope,
  buildResourceOwnershipInsert,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";

export type GithubRepoPayload = {
  id: number;
  full_name: string;
  default_branch?: string;
  owner?: {
    login?: string;
  };
  name?: string;
};

type RebindAutomationInstallationsDeps = {
  loadCurrentInstallations: (
    userId: string
  ) => Promise<Array<{ installation_id: number }>>;
  rebindFlows: (userId: string, installationId: number) => Promise<number>;
  rebindTriggers: (userId: string, installationId: number) => Promise<number>;
};

export type RebindAutomationInstallationsResult = {
  flowCount: number;
  triggerCount: number;
  skippedReason:
    | "none"
    | "no_current_installations"
    | "multiple_current_installations"
    | "current_installation_mismatch";
};

function toFiniteInstallationId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

const defaultRebindAutomationInstallationsDeps: RebindAutomationInstallationsDeps =
  {
    async loadCurrentInstallations(userId) {
      const { data, error } = await supabaseAdmin
        .from("github_installations")
        .select("installation_id")
        .eq("user_id", userId);

      if (error) {
        throw new Error(
          `Failed to load GitHub installations for automation rebind: ${error.message}`
        );
      }

      return (data || []).filter(
        (row): row is { installation_id: number } =>
          toFiniteInstallationId(row.installation_id) !== null
      );
    },
    async rebindFlows(userId, installationId) {
      const { data, error } = await supabaseAdmin
        .from("flows")
        .update({
          installation_id: installationId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .not("installation_id", "is", null)
        .neq("installation_id", installationId)
        .select("id");

      if (error) {
        throw new Error(
          `Failed to rebind flows to installation ${installationId}: ${error.message}`
        );
      }

      return data?.length ?? 0;
    },
    async rebindTriggers(userId, installationId) {
      const { data, error } = await supabaseAdmin
        .from("triggers")
        .update({ installation_id: installationId })
        .eq("user_id", userId)
        .not("installation_id", "is", null)
        .neq("installation_id", installationId)
        .select("id");

      if (error) {
        throw new Error(
          `Failed to rebind triggers to installation ${installationId}: ${error.message}`
        );
      }

      return data?.length ?? 0;
    },
  };

async function fetchGithubReposPage(token: string, page: number) {
  const res = await fetch(
    `https://api.github.com/user/repos?per_page=100&sort=updated&page=${page}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub repo sync failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<GithubRepoPayload[]>;
}

export async function fetchAllGithubRepos(token: string) {
  const repos: GithubRepoPayload[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const batch = await fetchGithubReposPage(token, page);
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  return repos;
}

function mapRepoPayload(
  userId: string,
  repo: GithubRepoPayload,
  githubInstallationId?: number | null
) {
  return {
    user_id: userId,
    github_id: repo.id,
    github_installation_id: githubInstallationId || null,
    full_name: repo.full_name,
    owner: repo.owner?.login || repo.full_name.split("/")[0] || null,
    name: repo.name || repo.full_name.split("/")[1] || null,
    default_branch: repo.default_branch || "main",
  };
}

type UpsertGithubReposOptions = {
  githubInstallationId?: number | null;
  workspaceId?: string | null;
  productTeamId?: string | null;
};

export function filterVisibleGithubRepos<
  T extends { github_installation_id?: number | null },
>(repos: T[], options: { preferInstallationCoverage: boolean }) {
  if (!options.preferInstallationCoverage) {
    return repos;
  }

  const coveredRepos = repos.filter((repo) =>
    Number.isFinite(repo.github_installation_id)
  );

  // When installation-backed sync is active, covered repos are the current
  // source of truth. Older OAuth-only rows can linger in the table after a
  // user moves to the GitHub App and should not crowd the active Projects list.
  return coveredRepos.length > 0 ? coveredRepos : repos;
}

export async function upsertGithubReposForUser(
  userId: string,
  repos: GithubRepoPayload[],
  options: UpsertGithubReposOptions = {}
) {
  if (repos.length === 0) return;
  const scope: ProductResourceScope = options.productTeamId
    ? { kind: "team", userId, productTeamId: options.productTeamId }
    : { kind: "personal", userId, productTeamId: null };
  const defaultWorkspace = await ensureDefaultWorkspaceForUser(userId, {
    productTeamId: scope.productTeamId,
  });
  const fallbackWorkspaceId = options.workspaceId || defaultWorkspace.id;

  const updateBaseRepo = async (
    repoId: string,
    mapped: ReturnType<typeof mapRepoPayload>,
    workspaceId?: string | null
  ) => {
    const patch: Record<string, unknown> = {
      full_name: mapped.full_name,
      owner: mapped.owner,
      name: mapped.name,
      default_branch: mapped.default_branch,
      workspace_id: workspaceId || fallbackWorkspaceId,
    };
    // Only overwrite github_installation_id when the caller explicitly provided
    // one (including null to detach). An OAuth-only sync has no installation
    // context and must not clobber an already-stored App installation ID.
    if (options.githubInstallationId !== undefined) {
      patch.github_installation_id = mapped.github_installation_id;
    }
    const { error } = await supabaseAdmin
      .from("repos")
      .update(patch)
      .eq("id", repoId);

    if (error)
      throw new Error(
        `Failed to update repo ${mapped.full_name}: ${error.message}`
      );
  };

  for (const repo of repos) {
    const mapped = mapRepoPayload(userId, repo, options.githubInstallationId);

    // Only sync base repo entries (root_directory IS NULL).
    // Sub-project spaces have their own root_directory and must not be overwritten.
    let existingQuery = supabaseAdmin
      .from("repos")
      .select("id, workspace_id")
      .eq("github_id", repo.id)
      .is("root_directory", null);
    existingQuery = applyResourceOwnerScope(existingQuery, scope);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      await updateBaseRepo(existing.id, mapped, existing.workspace_id);
    } else {
      const { error } = await supabaseAdmin.from("repos").insert({
        ...mapped,
        ...buildResourceOwnershipInsert(scope),
        workspace_id: fallbackWorkspaceId,
        root_directory: null,
      });
      if (error?.code === "23505") {
        let concurrentQuery = supabaseAdmin
          .from("repos")
          .select("id, workspace_id")
          .eq("github_id", repo.id)
          .is("root_directory", null);
        concurrentQuery = applyResourceOwnerScope(concurrentQuery, scope);
        const { data: concurrentExisting, error: lookupError } =
          await concurrentQuery.maybeSingle();

        if (lookupError) {
          throw new Error(
            `Failed to reconcile repo ${mapped.full_name} after duplicate insert: ${lookupError.message}`
          );
        }
        if (!concurrentExisting) {
          throw new Error(
            `Failed to reconcile repo ${mapped.full_name} after duplicate insert`
          );
        }

        await updateBaseRepo(
          concurrentExisting.id,
          mapped,
          concurrentExisting.workspace_id
        );
      } else if (error) {
        throw new Error(
          `Failed to insert repo ${mapped.full_name}: ${error.message}`
        );
      }
    }

    // Propagate GitHub metadata to sub-project spaces (full_name, default_branch, etc.)
    const subPatch: Record<string, unknown> = {
      full_name: mapped.full_name,
      owner: mapped.owner,
      name: mapped.name,
      default_branch: mapped.default_branch,
    };
    // Mirror the same guard as updateBaseRepo: only overwrite github_installation_id
    // when the caller explicitly provided one. OAuth-only syncs must not clobber
    // App installation IDs on sub-project spaces.
    if (options.githubInstallationId !== undefined) {
      subPatch.github_installation_id = mapped.github_installation_id;
    }
    let subprojectQuery = supabaseAdmin
      .from("repos")
      .update(subPatch)
      .eq("github_id", repo.id)
      .not("root_directory", "is", null);
    subprojectQuery = applyResourceOwnerScope(subprojectQuery, scope);
    await subprojectQuery;
  }
}

export async function upsertGithubReposForUsers(
  userIds: string[],
  repos: GithubRepoPayload[],
  githubInstallationId?: number | null
) {
  if (userIds.length === 0 || repos.length === 0) return;
  await Promise.all(
    userIds.map((userId) =>
      upsertGithubReposForUser(userId, repos, {
        githubInstallationId,
      })
    )
  );
}

export async function detachGithubInstallationReposForUsers(
  userIds: string[],
  installationId: number,
  repoGithubIds: number[]
) {
  if (userIds.length === 0 || repoGithubIds.length === 0) return;

  const { error } = await supabaseAdmin
    .from("repos")
    .update({ github_installation_id: null })
    .in("user_id", userIds)
    .eq("github_installation_id", installationId)
    .in("github_id", repoGithubIds);

  if (error) {
    throw new Error(`Failed to detach installation repos: ${error.message}`);
  }
}

export async function deleteGithubReposForUsers(
  userIds: string[],
  repoGithubIds: number[]
) {
  if (userIds.length === 0 || repoGithubIds.length === 0) return;

  // Delete base repos and their sub-project spaces (parent_repo_id cascade is SET NULL,
  // so we explicitly delete sub-projects first to keep things clean)
  const { error: subError } = await supabaseAdmin
    .from("repos")
    .delete()
    .in("user_id", userIds)
    .in("github_id", repoGithubIds)
    .not("root_directory", "is", null);

  if (subError) {
    throw new Error(`Failed to delete sub-project repos: ${subError.message}`);
  }

  const { error } = await supabaseAdmin
    .from("repos")
    .delete()
    .in("user_id", userIds)
    .in("github_id", repoGithubIds);

  if (error) {
    throw new Error(`Failed to delete repos: ${error.message}`);
  }
}

export async function rebindStaleAutomationInstallationBindingsForUser(
  userId: string,
  installationId: number,
  overrides: Partial<RebindAutomationInstallationsDeps> = {}
): Promise<RebindAutomationInstallationsResult> {
  const deps: RebindAutomationInstallationsDeps = {
    ...defaultRebindAutomationInstallationsDeps,
    ...overrides,
  };

  const currentInstallationIds = [
    ...new Set(
      (await deps.loadCurrentInstallations(userId))
        .map((row) => toFiniteInstallationId(row.installation_id))
        .filter((id): id is number => id !== null)
    ),
  ];

  if (currentInstallationIds.length === 0) {
    return {
      flowCount: 0,
      triggerCount: 0,
      skippedReason: "no_current_installations",
    };
  }

  if (currentInstallationIds.length > 1) {
    return {
      flowCount: 0,
      triggerCount: 0,
      skippedReason: "multiple_current_installations",
    };
  }

  if (currentInstallationIds[0] !== installationId) {
    return {
      flowCount: 0,
      triggerCount: 0,
      skippedReason: "current_installation_mismatch",
    };
  }

  const [flowCount, triggerCount] = await Promise.all([
    deps.rebindFlows(userId, installationId),
    deps.rebindTriggers(userId, installationId),
  ]);

  return {
    flowCount,
    triggerCount,
    skippedReason: "none",
  };
}

export async function syncGithubInstallationReposForUser(
  userId: string,
  installationId: number,
  options: { productTeamId?: string | null } = {}
) {
  const githubRepos = await fetchGithubInstallationRepos(installationId);
  await upsertGithubReposForUser(userId, githubRepos, {
    githubInstallationId: installationId,
    productTeamId: options.productTeamId,
  });

  if (!options.productTeamId) {
    const rebound = await rebindStaleAutomationInstallationBindingsForUser(
      userId,
      installationId
    );
    if (rebound.flowCount > 0 || rebound.triggerCount > 0) {
      console.info("[github-sync] rebound automation installation bindings", {
        userId,
        installationId,
        flowCount: rebound.flowCount,
        triggerCount: rebound.triggerCount,
      });
    }
  }
}

export async function syncGithubReposForUser(
  userId: string,
  oauthToken?: string | null,
  options: { productTeamId?: string | null } = {}
) {
  const scope: ProductResourceScope = options.productTeamId
    ? { kind: "team", userId, productTeamId: options.productTeamId }
    : { kind: "personal", userId, productTeamId: null };
  const { data: installations, error: installationsError } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id")
    .eq("user_id", userId);

  if (installationsError) {
    throw new Error(
      `Failed to load GitHub installations: ${installationsError.message}`
    );
  }

  const installationScopedSync =
    Boolean(installations?.length) && hasGithubAppConfig();

  if (installationScopedSync) {
    await Promise.all(
      installations.map((inst) =>
        syncGithubInstallationReposForUser(
          userId,
          Number(inst.installation_id),
          { productTeamId: options.productTeamId }
        )
      )
    );
  } else if (oauthToken) {
    const githubRepos = await fetchAllGithubRepos(oauthToken);
    await upsertGithubReposForUser(userId, githubRepos, {
      productTeamId: options.productTeamId,
    });
  }

  let query = supabaseAdmin
    .from("repos")
    .select("*")
    .or("is_hidden.is.null,is_hidden.eq.false")
    .order("is_favorite", { ascending: false })
    .order("full_name", { ascending: true });
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load synced repos: ${error.message}`);
  }

  return filterVisibleGithubRepos(data || [], {
    preferInstallationCoverage: installationScopedSync,
  });
}
