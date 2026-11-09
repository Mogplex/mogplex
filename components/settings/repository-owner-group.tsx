"use client";

import type { ReactNode } from "react";
import type { OwnerCoverage } from "@/lib/settings/repository-filter";
import { ConfirmRemoveButton } from "./repository-row";

const noun = (count: number) => (count === 1 ? "repository" : "repositories");

/**
 * One owner's connected repositories with its GitHub App status. Repositories
 * without the App came from the legacy OAuth sync and never run reviews or
 * automations, so the header offers to remove exactly those.
 */
export function RepositoryOwnerGroup({
  owner,
  coverage,
  shownCount,
  notConnectedCount,
  showRemove,
  removing,
  onRemoveNotConnected,
  children,
}: {
  owner: string;
  coverage: OwnerCoverage;
  shownCount: number;
  notConnectedCount: number;
  /** False when another control already removes the same repositories. */
  showRemove: boolean;
  removing: boolean;
  onRemoveNotConnected: () => void;
  children: ReactNode;
}) {
  const connected = coverage === "connected";

  return (
    <section aria-label={owner} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <h2 className="text-foreground text-sm font-medium">{owner}</h2>
        <span className="text-muted-foreground text-xs">
          {shownCount} {noun(shownCount)}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            connected
              ? "border-border text-foreground/80"
              : "border-destructive/40 text-destructive"
          }`}
        >
          {connected
            ? "GitHub App connected"
            : coverage === "none"
              ? "Not connected"
              : `${notConnectedCount} not connected`}
        </span>
        {connected ? null : (
          <>
            <span className="text-muted-foreground text-xs">
              {coverage === "none"
                ? "Imported by an older GitHub sign-in sync. PR reviews and automations never run here."
                : "Repositories marked Not connected were imported by an older GitHub sign-in sync. PR reviews and automations never run on them."}
            </span>
            {showRemove ? (
              <span className="ml-auto">
                <ConfirmRemoveButton
                  label={coverage === "none" ? "Remove all" : "Remove not connected"}
                  ariaLabel={`Remove not-connected repositories from ${owner}`}
                  title={`Remove ${notConnectedCount} not-connected ${noun(notConnectedCount)} from ${owner}?`}
                  confirmLabel={`Remove ${notConnectedCount} ${noun(notConnectedCount)}`}
                  disabled={removing}
                  onConfirm={onRemoveNotConnected}
                />
              </span>
            ) : null}
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
