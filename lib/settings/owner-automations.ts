import { getStartConfig } from "@/lib/flows/graph";
import { coerceGraph } from "@/lib/flows/graph-coerce";
import {
  evaluateTriggerFilter,
  normalizeAccountType,
} from "@/lib/flows/trigger-filter";
import type { Flow, FlowStartFilter } from "@/lib/types";

export type RepoAutomation = {
  id: string;
  name: string;
  filter: FlowStartFilter | undefined;
};

/**
 * Active GitHub-triggered automations with a published graph: the ones the
 * webhook router can start for a repository event.
 */
export function githubAutomations(
  flows: Array<
    Pick<Flow, "id" | "name" | "status" | "source_kind"> & {
      published_version?: { graph?: unknown } | null;
    }
  >
): RepoAutomation[] {
  const automations: RepoAutomation[] = [];
  for (const flow of flows) {
    if (flow.status !== "active" || flow.source_kind !== "github") continue;
    const graph = flow.published_version?.graph;
    if (!graph) continue;
    const start = getStartConfig(coerceGraph(graph));
    if (!start) continue;
    automations.push({ id: flow.id, name: flow.name, filter: start.filter });
  }
  return automations;
}

/**
 * Automations that can run on at least one of an owner's repositories,
 * judged with the webhook router's own trigger filter. The author filter is
 * left out: it depends on each pull request, not on the repository, so a
 * Dependabot-only review still runs here. The account type is the stored
 * installation value, normalized exactly as the router does (unknown → User).
 */
export function automationsForOwner(
  automations: RepoAutomation[],
  repos: Array<{ full_name: string; github_installation_id?: number | null }>,
  installationAccountType: string | null | undefined
): RepoAutomation[] {
  const accountType = normalizeAccountType(installationAccountType);
  return automations.filter((automation) => {
    const filter = automation.filter && {
      ...automation.filter,
      authorFilter: undefined,
    };
    return repos.some(
      (repo) =>
        repo.github_installation_id != null &&
        evaluateTriggerFilter(filter, {
          installationId: repo.github_installation_id,
          repoFullName: repo.full_name,
          accountType,
        })
    );
  });
}

/**
 * The installation behind an owner's repositories. Prefers the installation
 * whose account is the owner (a transferred repository keeps its old
 * installation id until the next sync), else the first one carrying an
 * installation id the installations list knows. Null when none does.
 */
export function installationForOwner<
  T extends { account_login?: string | null },
>(
  owner: string,
  repos: Array<{ github_installation_id?: number | null }>,
  installationsById: ReadonlyMap<number, T>
): T | null {
  const login = owner.toLowerCase();
  for (const installation of installationsById.values()) {
    if (installation.account_login?.toLowerCase() === login)
      return installation;
  }
  for (const repo of repos) {
    const id = Number(repo.github_installation_id);
    if (repo.github_installation_id == null || !Number.isFinite(id)) continue;
    const installation = installationsById.get(id);
    if (installation) return installation;
  }
  return null;
}

/** Most recent full repository sync across installations, or null. */
export function latestRepoSync(
  installations: Array<{ repos_synced_at?: string | null }>
): string | null {
  let latest: string | null = null;
  for (const installation of installations) {
    const syncedAt = installation.repos_synced_at;
    if (syncedAt && (!latest || Date.parse(syncedAt) > Date.parse(latest))) {
      latest = syncedAt;
    }
  }
  return latest;
}
