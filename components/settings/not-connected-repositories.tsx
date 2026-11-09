"use client";

import type { Repo } from "@/lib/types";
import { ConfirmRemoveButton } from "./repository-row";

const noun = (count: number) => (count === 1 ? "repository" : "repositories");

/**
 * Repositories without a GitHub App installation, kept out of the main list.
 * They came from the legacy OAuth sync of every repository the account could
 * see; GitHub sends Mogplex no webhooks for them, and the rest of the app
 * hides them once any repository is covered (see `visibleScopedRepos`).
 */
export function NotConnectedRepositories({
  repos,
  removing,
  removingLabel,
  onRemoveAll,
}: {
  repos: Repo[];
  removing: boolean;
  /** Progress text shown on the button while a removal runs. */
  removingLabel: string | null;
  onRemoveAll: () => void;
}) {
  const count = repos.length;
  return (
    <section
      aria-label="Not connected repositories"
      className="border-border bg-card/40 space-y-2 rounded-md border border-dashed px-3 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-foreground text-sm">
            {count} {noun(count)} not connected
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            An older GitHub sign-in imported these. The Mogplex GitHub App
            isn&apos;t installed on them, so PR reviews and automations never
            run there and they don&apos;t appear anywhere else in Mogplex.
          </p>
        </div>
        <ConfirmRemoveButton
          label={removingLabel ?? "Remove all"}
          ariaLabel="Remove all not-connected repositories"
          title={`Remove ${count} not-connected ${noun(count)}?`}
          confirmLabel={`Remove ${count} ${noun(count)}`}
          description="Nothing changes on GitHub. They stay hidden, and if you later install the GitHub App for these owners and sync, you can restore them from Show removed."
          disabled={removing}
          onConfirm={onRemoveAll}
        />
      </div>
      <details className="text-xs">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
          Show {noun(count)}
        </summary>
        <ul className="text-muted-foreground mt-1.5 space-y-0.5">
          {repos.map((repo) => (
            <li key={repo.id}>{repo.full_name}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
