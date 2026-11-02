"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scopedHref } from "@/lib/scoped-href";
import { trackActivation } from "@/lib/activation-tracking";
import type { Repo } from "@/lib/types";
import { repoOwner, useRepositoryAdmin } from "./use-repository-admin";

function RepositoryRow({
  repo,
  onToggle,
}: {
  repo: Repo;
  onToggle: (repo: Repo) => void;
}) {
  const removed = Boolean(repo.is_hidden);
  return (
    <li className="border-border flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0">
      <span className="min-w-0 truncate text-sm">{repo.full_name}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`${removed ? "Restore" : "Remove"} ${repo.full_name}`}
        className={removed ? undefined : "text-destructive hover:text-destructive"}
        onClick={() => onToggle(repo)}
      >
        {removed ? "Restore" : "Remove"}
      </Button>
    </li>
  );
}

/**
 * Settings home for connected repositories: GitHub sync, remove and restore
 * repositories, and a link to sandbox management. Day-to-day repo work lives
 * in Command Center.
 */
export function RepositoriesSection() {
  const { scope } = useParams<{ scope: string }>();
  const admin = useRepositoryAdmin();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [showRemoved, setShowRemoved] = useState(false);

  const owners = useMemo(
    () => [...new Set(admin.repos.map(repoOwner))].sort(),
    [admin.repos]
  );
  const query = search.trim().toLowerCase();
  const matches = admin.repos
    .filter((repo) => owner === "all" || repoOwner(repo) === owner)
    .filter((repo) => repo.full_name.toLowerCase().includes(query))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const connected = matches.filter((repo) => !repo.is_hidden);
  const removed = matches.filter((repo) => repo.is_hidden);
  const removedTotal = admin.repos.filter((repo) => repo.is_hidden).length;
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
        {owner !== "all" && connected.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => void admin.removeOwner(owner)}
          >
            Remove all from {owner}
          </Button>
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
        <ul aria-label="Connected repositories" className="border-border rounded-md border">
          {connected.length === 0 ? (
            <li className="text-muted-foreground px-3 py-4 text-xs">
              {query || owner !== "all"
                ? "No connected repositories match."
                : "No connected repositories yet. Sync GitHub to import them."}
            </li>
          ) : (
            connected.map((repo) => (
              <RepositoryRow
                key={repo.id}
                repo={repo}
                onToggle={(item) => void admin.toggleHidden(item)}
              />
            ))
          )}
        </ul>
      )}

      {showRemoved && removed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="ui-section-title">Removed repositories</h2>
          <ul aria-label="Removed repositories" className="border-border rounded-md border">
            {removed.map((repo) => (
              <RepositoryRow
                key={repo.id}
                repo={repo}
                onToggle={(item) => void admin.toggleHidden(item)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
