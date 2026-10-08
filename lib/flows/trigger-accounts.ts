import type { FlowStartFilter, TriggerEvent } from "@/lib/types";

// These triggers run against one repository, so they bind exactly one GitHub
// installation (server validation enforces it). GitHub event triggers can
// span any number of installations.
export const SINGLE_INSTALLATION_TRIGGER_EVENTS: ReadonlySet<TriggerEvent> =
  new Set<TriggerEvent>(["schedule", "webhook", "slack_mention"]);

type TriggerStart = {
  event?: TriggerEvent | string | null;
  filter?: FlowStartFilter | null;
} | null;

/**
 * Which GitHub installations can start a trigger, mirroring webhook routing
 * (`evaluateTriggerFilter`): a GitHub event trigger without `installationIds`
 * runs for every installation its owner connects, including ones connected
 * later. Returns `null` for that "all accounts" case.
 *
 * `flows.installation_id` is not a routing input for GitHub events; it is
 * only the bound installation for single-repository triggers.
 */
export function resolveTriggerInstallationIds(
  start: TriggerStart,
  flowInstallationId: number | null | undefined
): number[] | null {
  const scoped = start?.filter?.installationIds ?? [];
  if (
    start?.event &&
    SINGLE_INSTALLATION_TRIGGER_EVENTS.has(start.event as TriggerEvent)
  ) {
    if (scoped.length === 1) return scoped;
    return flowInstallationId == null ? [] : [flowInstallationId];
  }
  return scoped.length > 0 ? scoped : null;
}

export function triggerCoversInstallation(
  installationIds: number[] | null,
  installationId: number
) {
  return installationIds === null || installationIds.includes(installationId);
}

/**
 * Builds the start filter from editor state. An empty `installationIds` means
 * "all connected accounts" and is omitted, never pinned to one account.
 */
export function buildTriggerFilter(
  installationIds: number[],
  repos: string[],
  authorFilter: NonNullable<FlowStartFilter["authorFilter"]>
): FlowStartFilter | undefined {
  if (
    installationIds.length === 0 &&
    repos.length === 0 &&
    authorFilter === "any"
  ) {
    return undefined;
  }
  return {
    scope: "all",
    ...(installationIds.length > 0 ? { installationIds } : {}),
    ...(repos.length > 0 ? { repos } : {}),
    ...(authorFilter === "any" ? {} : { authorFilter }),
  };
}

type InstallationRepos = {
  installation_id: number;
  repositories: Array<{ full_name: string }>;
};

/**
 * Keeps the repository scope that still belongs to the selected accounts when
 * the account selection changes. "All accounts" keeps every repository.
 */
export function pruneReposToInstallations(
  repos: string[],
  installationIds: number[],
  installations: InstallationRepos[]
) {
  if (installationIds.length === 0) return repos;
  const selected = new Set(installationIds);
  const available = new Set(
    installations
      .filter((installation) => selected.has(installation.installation_id))
      .flatMap((installation) =>
        installation.repositories.map((repo) => repo.full_name.toLowerCase())
      )
  );
  return repos.filter((repo) => available.has(repo.toLowerCase()));
}

type LabeledInstallation = {
  installation_id: number;
  account_login: string | null;
};

export function installationLoginLabel(installation: LabeledInstallation) {
  return (
    installation.account_login || `Installation ${installation.installation_id}`
  );
}

/** Short account summary for the trigger inspector and canvas node. */
export function describeTriggerAccounts(
  installationIds: number[] | null,
  installations: LabeledInstallation[]
) {
  if (installationIds === null) return "All accounts";
  const labels = installationIds.map((id) => {
    const installation = installations.find(
      (candidate) => candidate.installation_id === id
    );
    return installation
      ? installationLoginLabel(installation)
      : `Installation ${id}`;
  });
  if (labels.length === 0) return "No account";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.length} accounts`;
}
