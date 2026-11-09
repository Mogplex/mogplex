"use client";

import type { NotConnectedReason } from "@/lib/settings/repository-filter";
import type { Repo } from "@/lib/types";
import { ConfirmRemoveButton } from "./repository-row";

const noun = (count: number) => (count === 1 ? "repository" : "repositories");

const REASON_LABEL: Record<NotConnectedReason, string> = {
  not_selected: "not selected in the GitHub App's repository access",
  not_installed: "GitHub App not installed for this owner",
};

/**
 * Repositories the GitHub App doesn't cover, kept out of the main list: either
 * the App isn't installed for their owner, or the installation's repository
 * selection leaves them out. They came from the legacy OAuth sync of every
 * repository the account could see; GitHub sends Mogplex no webhooks for them,
 * and the rest of the app hides them once any repository is covered (see
 * `visibleScopedRepos`).
 */
export function NotConnectedRepositories({
  repos,
  removing,
  removingLabel,
  onRemoveAll,
}: {
  repos: Array<{ repo: Repo; reason: NotConnectedReason }>;
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
            An older GitHub sign-in imported these, and the Mogplex GitHub App
            doesn&apos;t cover them, so PR reviews and automations never run
            there and they don&apos;t appear anywhere else in Mogplex.
          </p>
        </div>
        <ConfirmRemoveButton
          label={removingLabel ?? "Remove all"}
          ariaLabel="Remove all not-connected repositories"
          title={`Remove ${count} not-connected ${noun(count)}?`}
          confirmLabel={`Remove ${count} ${noun(count)}`}
          description="Nothing changes on GitHub. They stay hidden. Once the GitHub App covers them (install it for the owner, or add them to an existing installation's repository access) and you sync, you can restore them from Show removed."
          disabled={removing}
          onConfirm={onRemoveAll}
        />
      </div>
      <details className="text-xs">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
          Show {noun(count)}
        </summary>
        <ul className="text-muted-foreground mt-1.5 space-y-0.5">
          {repos.map(({ repo, reason }) => (
            <li key={repo.id}>
              <span className="text-foreground/80">{repo.full_name}</span>
              {" · "}
              {REASON_LABEL[reason]}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
