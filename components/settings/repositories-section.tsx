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
import {
  filterRepositories,
  groupRepositoriesByOwner,
  isAppConnected,
  repoOwner,
} from "@/lib/settings/repository-filter";
import type { Repo } from "@/lib/types";
import { ConfirmRemoveButton, RepositoryRow } from "./repository-row";
import { RepositoryOwnerGroup } from "./repository-owner-group";
import { useRepositoryAdmin } from "./use-repository-admin";

/**
 * Settings home for connected repositories: GitHub sync, project settings,
 * remove and restore repositories, and a link to sandbox management.
 * Day-to-day repo work lives in Command Center.
 */
export function RepositoriesSection() {
  const { scope } = useParams<{ scope: string }>();
  const admin = useRepositoryAdmin();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [showRemoved, setShowRemoved] = useState(false);
  const [settingsRepoId, setSettingsRepoId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<ProjectSettingsTab>("env");

  const owners = useMemo(
    () => [...new Set(admin.repos.map(repoOwner))].sort(),
    [admin.repos]
  );
  const { query, connected, removed, removedTotal, ownerConnectedCount } =
    filterRepositories(admin.repos, { owner, search });
  const openSettings = (repo: Repo) => {
    setSettingsTab("env");
    setSettingsRepoId(repo.id);
  };
  const renderRow = (repo: Repo, notConnected = false) => (
    <RepositoryRow
      key={repo.id}
      repo={repo}
      pending={admin.pendingIds.has(repo.id)}
      notConnected={notConnected}
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
            onClick={() => void admin.sync()}
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
        {owner !== "all" && ownerConnectedCount > 0 ? (
          <ConfirmRemoveButton
            label={`Remove all from ${owner}`}
            title={`Remove all ${ownerConnectedCount} ${ownerConnectedCount === 1 ? "repository" : "repositories"} from ${owner}?`}
            confirmLabel={`Remove ${ownerConnectedCount} ${ownerConnectedCount === 1 ? "repository" : "repositories"}`}
            disabled={admin.removingOwner}
            onConfirm={() => void admin.removeOwner(owner)}
          />
        ) : null}
        {removedTotal > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={showRemoved}
            onClick={() => setShowRemoved((current) => !current)}
          >
            {showRemoved ? "Hide removed" : `Show removed (${removedTotal})`}
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
            {groupRepositoriesByOwner(connected, admin.repos).map((group) => (
              <RepositoryOwnerGroup
                key={group.owner}
                owner={group.owner}
                coverage={group.coverage}
                shownCount={group.repos.length}
                notConnectedCount={group.notConnected.length}
                // The toolbar's "Remove all from owner" already hides this set.
                showRemove={!(owner === group.owner && group.coverage === "none")}
                removing={admin.removingOwner}
                onRemoveNotConnected={() =>
                  void admin.removeOwner(group.owner, { notConnectedOnly: true })
                }
              >
                {group.repos.map((repo) =>
                  renderRow(
                    repo,
                    group.coverage === "partial" && !isAppConnected(repo)
                  )
                )}
              </RepositoryOwnerGroup>
            ))}
          </div>
        )
      )}

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
