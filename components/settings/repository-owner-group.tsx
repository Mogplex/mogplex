"use client";

import type { ReactNode } from "react";
import { ConfirmRemoveButton } from "./repository-row";

/**
 * One owner's connected repositories with its GitHub App status. Owners
 * without the App get a remove-all action, because their repositories came
 * from the legacy OAuth sync and never run reviews or automations.
 */
export function RepositoryOwnerGroup({
  owner,
  appInstalled,
  shownCount,
  totalCount,
  removing,
  onRemoveAll,
  children,
}: {
  owner: string;
  appInstalled: boolean;
  shownCount: number;
  totalCount: number;
  removing: boolean;
  onRemoveAll: () => void;
  children: ReactNode;
}) {
  const noun = (count: number) => (count === 1 ? "repository" : "repositories");

  return (
    <section aria-label={owner} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <h2 className="text-foreground text-sm font-medium">{owner}</h2>
        <span className="text-muted-foreground text-xs">
          {shownCount} {noun(shownCount)}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            appInstalled
              ? "border-border text-foreground/80"
              : "border-destructive/40 text-destructive"
          }`}
        >
          {appInstalled ? "GitHub App connected" : "Not connected"}
        </span>
        {appInstalled ? null : (
          <>
            <span className="text-muted-foreground text-xs">
              Imported by an older GitHub sign-in sync. PR reviews and
              automations never run here.
            </span>
            <span className="ml-auto">
              <ConfirmRemoveButton
                label="Remove all"
                ariaLabel={`Remove all not-connected repositories from ${owner}`}
                title={`Remove all ${totalCount} ${noun(totalCount)} from ${owner}?`}
                confirmLabel={`Remove ${totalCount} ${noun(totalCount)}`}
                disabled={removing}
                onConfirm={onRemoveAll}
              />
            </span>
          </>
        )}
      </div>
      <ul
        aria-label={`${owner} repositories`}
        className="border-border rounded-md border"
      >
        {children}
      </ul>
    </section>
  );
}
