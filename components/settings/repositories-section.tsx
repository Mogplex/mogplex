"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ProjectSettingsDrawer,
  type ProjectSettingsTab,
} from "@/components/project-settings/project-settings-drawer";
import { SandboxLaunchProvider } from "@/components/sandbox-launch-provider";
import { scopedHref } from "@/lib/scoped-href";
import { trackActivation } from "@/lib/activation-tracking";
import { useUser } from "@/hooks/use-user";
import {
  activeOwnerRepos,
  filterRepositories,
  groupRepositoriesByOwner,
  notConnectedReasons,
  repoOwner,
  splitByAppConnection,
} from "@/lib/settings/repository-filter";
import {
  automationsForOwner,
  installationForOwner,
} from "@/lib/settings/owner-automations";
import { timeAgo } from "@/lib/observability/formatters";
import type { Repo } from "@/lib/types";
import { NotConnectedRepositories } from "./not-connected-repositories";
import { ConfirmRemoveButton, RepositoryRow } from "./repository-row";
import { RepositoryOwnerGroup } from "./repository-owner-group";
import { useRepositoryAdmin } from "./use-repository-admin";
import { useRepositoryContext } from "./use-repository-context";

/**
 * Settings home for connected repositories: GitHub sync, project settings,
 * remove and restore repositories, and a link to sandbox management.
 * Repositories are grouped by GitHub owner; ones without a GitHub App
 * installation are listed apart. Day-to-day repo work lives in Command Center.
 */
export function RepositoriesSection() {
  const { scope } = useParams<{ scope: string }>();
  const admin = useRepositoryAdmin();
  const { user } = useUser();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [showRemoved, setShowRemoved] = useState(false);
  const [settingsRepoId, setSettingsRepoId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<ProjectSettingsTab>("env");

  const { inventory, notConnected } = useMemo(
    () => splitByAppConnection(admin.repos),
    [admin.repos]
  );
  const owners = useMemo(
    () => [...new Set(inventory.map(repoOwner))].sort(),
    [inventory]
  );
  const { query, connected, removed, ownerRepos } = useMemo(
    () => ({
      ...filterRepositories(inventory, { owner, search }),
      ownerRepos: activeOwnerRepos(inventory, owner),
    }),
    [inventory, owner, search]
  );
  const selfLogin = user?.github_username;
  const groups = useMemo(
    () => groupRepositoriesByOwner(connected, selfLogin),
    [connected, selfLogin]
  );
  const context = useRepositoryContext();
  const groupDetails = useMemo(
    () =>
      groups.map((group) => {
        // Judge the owner by all its connected repositories, not the search.
        const ownerAll = activeOwnerRepos(inventory, group.owner);
        const installation = installationForOwner(
          ownerAll,
          context.installationsById
        );
        return {
          ...group,
          manageUrl: installation?.manage_url ?? null,
          automations: installation
            ? automationsForOwner(
                context.automations,
                ownerAll,
                installation.account_type
              )
            : [],
        };
      }),
    [groups, inventory, context]
  );
  const notConnectedRepos = notConnected.filter((repo) => !repo.is_hidden);
  const { removalProgress } = admin;
  const removingLabel = removalProgress
    ? `Removing ${removalProgress.done}/${removalProgress.total}…`
    : null;
  const openSettings = (repo: Repo) => {
    setSettingsTab("env");
    setSettingsRepoId(repo.id);
  };
  const renderRow = (repo: Repo, label?: string) => (
    <RepositoryRow
      key={repo.id}
      repo={repo}
      label={label}
      pending={admin.pendingIds.has(repo.id)}
      onToggle={(item) => void admin.toggleHidden(item)}
      onOpenSettings={openSettings}
    />
  );
  const { githubSetup } = admin;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {githubSetup.canSyncRepos ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={admin.syncing}
            onClick={() =>
              void admin
                .sync()
                .then(() => context.refreshInstallations())
                .catch(() => undefined)
            }
          >
            {admin.syncing ? "Syncing…" : "Sync GitHub"}
          </Button>
        ) : githubSetup.primaryAction ? (
          <Button asChild variant="outline" size="sm">
            <a
              href={githubSetup.primaryAction.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                trackActivation("github_connect_started", {
                  source: "settings_repositories",
                  connection_mode:
                    githubSetup.primaryAction?.kind === "connect" ? "oauth" : "app",
                })
              }
            >
              {githubSetup.primaryAction.label}
            </a>
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <Link href={scopedHref(scope, "/sandboxes")}>Manage sandboxes</Link>
        </Button>
        {context.lastSyncedAt ? (
          <span
            className="text-muted-foreground text-xs"
            title={new Date(context.lastSyncedAt).toLocaleString()}
          >
            Last synced {timeAgo(context.lastSyncedAt)}
          </span>
        ) : null}
      </div>
      {admin.syncError ? (
        <p role="alert" className="text-destructive text-xs">
          {admin.syncError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search repositories"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search repositories…"
          className="h-8 w-full text-xs sm:w-64"
        />
        {owners.length > 1 ? (
          <select
            aria-label="Owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className="border-border bg-secondary h-8 rounded border px-2 text-xs"
          >
            <option value="all">All owners</option>
            {owners.map((login) => (
              <option key={login} value={login}>
                {login}
              </option>
            ))}
          </select>
        ) : null}
        {owner !== "all" && ownerRepos.length > 0 ? (
          <ConfirmRemoveButton
            label={removingLabel ?? `Remove all from ${owner}`}
            ariaLabel={`Remove all from ${owner}`}
            title={`Remove all ${ownerRepos.length} ${ownerRepos.length === 1 ? "repository" : "repositories"} from ${owner}?`}
            confirmLabel={`Remove ${ownerRepos.length} ${ownerRepos.length === 1 ? "repository" : "repositories"}`}
            disabled={admin.removingOwner}
            onConfirm={() =>
              void admin.removeRepos(ownerRepos, `Hidden from ${owner}.`)
            }
          />
        ) : null}
        {removed.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={showRemoved}
            onClick={() => setShowRemoved((current) => !current)}
          >
            {showRemoved ? "Hide removed" : `Show removed (${removed.length})`}
          </Button>
        ) : null}
      </div>

      {admin.loadError ? (
        <p role="alert" className="text-destructive text-xs">
          {admin.loadError}
        </p>
      ) : admin.isLoading ? (
        <p role="status" className="text-muted-foreground text-xs">
          Loading repositories…
        </p>
      ) : (
        connected.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-md border px-3 py-4 text-xs">
            {query || owner !== "all"
              ? "No connected repositories match."
              : "No connected repositories yet. Sync GitHub to import them."}
          </p>
        ) : (
          <div aria-label="Connected repositories" role="region" className="space-y-4">
            {groupDetails.map(
              (group) => (
                <RepositoryOwnerGroup
                  key={group.owner}
                  owner={group.owner}
                  count={group.repos.length}
                  manageUrl={group.manageUrl}
                  automations={group.automations}
                  automationsHref={scopedHref(scope, "/workflows")}
                >
                  {group.repos.map((repo) =>
                    renderRow(repo, repo.name || repo.full_name)
                  )}
                </RepositoryOwnerGroup>
              )
            )}
          </div>
        )
      )}

      {/* Filters narrow the connected list only, so the card (and its
          Remove all over every not-connected repository) waits until they clear. */}
      {!admin.isLoading &&
      !admin.loadError &&
      !query &&
      owner === "all" &&
      notConnectedRepos.length > 0 ? (
        <NotConnectedRepositories
          repos={notConnectedReasons(
            notConnectedRepos,
            admin.repos,
            context.installedOwners
          )}
          removing={admin.removingOwner}
          removingLabel={removingLabel}
          onRemoveAll={() =>
            void admin.removeRepos(
              notConnectedRepos,
              "Hidden repositories without the GitHub App."
            )
          }
        />
      ) : null}

      {showRemoved && removed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="ui-section-title">Removed repositories</h2>
          <ul aria-label="Removed repositories" className="border-border rounded-md border">
            {removed.map((repo) => renderRow(repo))}
          </ul>
        </section>
      ) : null}

      {/* Control mounts this provider in its shell; Settings needs its own
          for the drawer's restart action. */}
      <SandboxLaunchProvider>
        <ProjectSettingsDrawer
          repoId={settingsRepoId}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          onClose={() => setSettingsRepoId(null)}
        />
      </SandboxLaunchProvider>
    </div>
  );
}
