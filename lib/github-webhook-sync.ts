import type { GithubRepoPayload } from "@/lib/github-sync";

type GithubWebhookInstallation = {
  id?: number;
  account?: {
    login?: string;
    type?: string;
  };
  target_type?: string;
  permissions?: Record<string, string>;
};

type GithubWebhookBody = Record<string, unknown> & {
  action?: string;
  sender?: { login?: string };
  installation?: GithubWebhookInstallation;
  repository?: GithubRepoPayload;
  repositories_added?: GithubRepoPayload[];
  repositories_removed?: Array<{ id: number }>;
};

export type GithubWebhookSyncPlan =
  | { type: "none" }
  | {
      type: "installation";
      action: string;
      installationId: number;
      senderLogin: string | null;
      accountLogin: string | null;
      accountType: string | null;
      targetType: string | null;
      permissions: Record<string, string>;
    }
  | {
      type: "installation_repositories";
      action: string;
      installationId: number;
      senderLogin: string | null;
      accountLogin: string | null;
      accountType: string | null;
      targetType: string | null;
      permissions: Record<string, string>;
      addedRepos: GithubRepoPayload[];
      removedRepoIds: number[];
    }
  | {
      type: "repository";
      action: string;
      installationId: number;
      senderLogin: string | null;
      accountLogin: string | null;
      accountType: string | null;
      targetType: string | null;
      permissions: Record<string, string>;
      repo: GithubRepoPayload;
    };

function getInstallationBase(body: GithubWebhookBody) {
  const installationId = Number(body.installation?.id);
  if (!Number.isFinite(installationId)) return null;

  return {
    installationId,
    senderLogin: body.sender?.login?.trim() || null,
    accountLogin: body.installation?.account?.login?.trim() || null,
    accountType: body.installation?.account?.type?.trim() || null,
    targetType: body.installation?.target_type?.trim() || null,
    permissions: body.installation?.permissions || {},
  };
}

export function planGithubWebhookSync(
  event: string | null,
  body: GithubWebhookBody
): GithubWebhookSyncPlan {
  if (!event) return { type: "none" };

  const base = getInstallationBase(body);
  if (!base) return { type: "none" };

  if (event === "installation") {
    return {
      type: "installation",
      action: body.action || "",
      ...base,
    };
  }

  if (event === "installation_repositories") {
    return {
      type: "installation_repositories",
      action: body.action || "",
      ...base,
      addedRepos: body.repositories_added || [],
      removedRepoIds: (body.repositories_removed || [])
        .map((repo) => repo.id)
        .filter((id): id is number => Number.isFinite(id)),
    };
  }

  if (event === "repository" && body.repository) {
    return {
      type: "repository",
      action: body.action || "",
      ...base,
      repo: body.repository,
    };
  }

  return { type: "none" };
}

async function resolveWebhookUserIds(
  installationId: number,
  senderLogin: string | null
) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data: known, error: knownError } = await supabaseAdmin
    .from("github_installations")
    .select("user_id")
    .eq("installation_id", installationId);

  if (knownError) {
    throw new Error(
      `Failed to load installation owners: ${knownError.message}`
    );
  }

  const knownUserIds = [
    ...new Set(
      (known || []).map((row) => row.user_id as string).filter(Boolean)
    ),
  ];
  if (knownUserIds.length > 0) {
    return knownUserIds;
  }

  if (!senderLogin) return [];

  const { data: profiles, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("github_username", senderLogin);

  if (profileError) {
    throw new Error(`Failed to load sender profile: ${profileError.message}`);
  }

  return [
    ...new Set((profiles || []).map((row) => row.id as string).filter(Boolean)),
  ];
}

async function ensureInstallationForUsers(
  userIds: string[],
  plan: Extract<GithubWebhookSyncPlan, { installationId: number }>
) {
  if (userIds.length === 0) return;
  const { supabaseAdmin } = await import("@/lib/supabase/admin");

  const rows = userIds.map((userId) => ({
    user_id: userId,
    installation_id: plan.installationId,
    account_login: plan.accountLogin,
    account_type: plan.accountType,
    target_type: plan.targetType,
    permissions: plan.permissions || {},
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("github_installations")
    .upsert(rows, { onConflict: "user_id,installation_id" });

  if (error) {
    throw new Error(
      `Failed to persist GitHub installation from webhook: ${error.message}`
    );
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ github_auth_mode: "app" })
    .in("id", userIds);

  if (profileError) {
    throw new Error(
      `Failed to update GitHub auth mode from webhook: ${profileError.message}`
    );
  }
}

async function removeInstallationForUsers(
  userIds: string[],
  installationId: number
) {
  if (userIds.length === 0) return;
  const { supabaseAdmin } = await import("@/lib/supabase/admin");

  const { error: installationError } = await supabaseAdmin
    .from("github_installations")
    .delete()
    .in("user_id", userIds)
    .eq("installation_id", installationId);

  if (installationError) {
    throw new Error(
      `Failed to remove GitHub installation from webhook: ${installationError.message}`
    );
  }

  const { error: repoError } = await supabaseAdmin
    .from("repos")
    .update({ github_installation_id: null })
    .in("user_id", userIds)
    .eq("github_installation_id", installationId);

  if (repoError) {
    throw new Error(
      `Failed to detach installation repos from webhook: ${repoError.message}`
    );
  }
}

async function syncInstallationReposForUsers(
  userIds: string[],
  installationId: number
) {
  const { syncGithubInstallationReposForUser } =
    await import("@/lib/github-sync");
  await Promise.all(
    userIds.map((userId) =>
      syncGithubInstallationReposForUser(userId, installationId)
    )
  );
}

export async function syncGithubWebhookState(
  event: string | null,
  body: GithubWebhookBody
) {
  const plan = planGithubWebhookSync(event, body);
  if (plan.type === "none") {
    return { handled: false, matchedUsers: 0 };
  }

  const userIds = await resolveWebhookUserIds(
    plan.installationId,
    plan.senderLogin
  );
  if (userIds.length === 0) {
    return {
      handled: true,
      matchedUsers: 0,
      event: plan.type,
      action: plan.action,
    };
  }

  if (plan.type === "installation") {
    if (["created", "new_permissions", "unsuspend"].includes(plan.action)) {
      await ensureInstallationForUsers(userIds, plan);
      await syncInstallationReposForUsers(userIds, plan.installationId);
    } else if (["deleted", "suspend"].includes(plan.action)) {
      await removeInstallationForUsers(userIds, plan.installationId);
    }

    return {
      handled: true,
      matchedUsers: userIds.length,
      event: plan.type,
      action: plan.action,
    };
  }

  if (plan.type === "installation_repositories") {
    const { detachGithubInstallationReposForUsers, upsertGithubReposForUsers } =
      await import("@/lib/github-sync");
    await ensureInstallationForUsers(userIds, plan);

    if (plan.addedRepos.length > 0) {
      await upsertGithubReposForUsers(
        userIds,
        plan.addedRepos,
        plan.installationId
      );
    }

    if (plan.removedRepoIds.length > 0) {
      await detachGithubInstallationReposForUsers(
        userIds,
        plan.installationId,
        plan.removedRepoIds
      );
    }

    return {
      handled: true,
      matchedUsers: userIds.length,
      event: plan.type,
      action: plan.action,
      added: plan.addedRepos.length,
      removed: plan.removedRepoIds.length,
    };
  }

  if (plan.type === "repository") {
    const { deleteGithubReposForUsers, upsertGithubReposForUsers } =
      await import("@/lib/github-sync");
    await ensureInstallationForUsers(userIds, plan);

    if (["deleted"].includes(plan.action)) {
      await deleteGithubReposForUsers(userIds, [plan.repo.id]);
    } else if (
      [
        "created",
        "renamed",
        "transferred",
        "unarchived",
        "publicized",
        "privatized",
      ].includes(plan.action)
    ) {
      await upsertGithubReposForUsers(
        userIds,
        [plan.repo],
        plan.installationId
      );
    }

    return {
      handled: true,
      matchedUsers: userIds.length,
      event: plan.type,
      action: plan.action,
      repo: plan.repo.full_name,
    };
  }

  return { handled: false, matchedUsers: 0 };
}
