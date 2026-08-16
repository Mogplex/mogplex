"use client";

import type { GithubRepoNameValidation } from "@/lib/github-repo-name";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AvailabilityState =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "unverified"
  | "invalid";

/**
 * Owner + name controls for a new project.
 *
 * Deliberately a fragment, not a wrapper: these sit directly in the composer's
 * `items-center` project row alongside the project select. Wrapping them in a
 * column with the status line made the block taller than its siblings, so
 * centring pushed the project select visibly out of line with them.
 */
export function NewProjectFields({
  ownerTargets,
  ownerLogin,
  onOwnerChange,
  ownersLoading,
  name,
  onNameChange,
  namePlaceholder,
  availability,
}: {
  ownerTargets: GithubRepoOwnerTarget[];
  ownerLogin: string;
  onOwnerChange: (value: string) => void;
  ownersLoading: boolean;
  name: string;
  onNameChange: (value: string) => void;
  namePlaceholder: string;
  availability: AvailabilityState;
}) {
  return (
    <>
      <Select
        value={ownerLogin}
        onValueChange={onOwnerChange}
        disabled={ownersLoading || ownerTargets.length === 0}
      >
        <SelectTrigger
          size="sm"
          aria-label="GitHub owner"
          className="border-border bg-secondary text-secondary-foreground h-8 w-44 max-w-full px-2 text-xs font-medium shadow-none"
        >
          <SelectValue
            placeholder={ownersLoading ? "Loading accounts…" : "GitHub owner"}
          />
        </SelectTrigger>
        <SelectContent className="border-border bg-popover max-h-72 shadow-2xl">
          {ownerTargets.map((target) => (
            <SelectItem key={target.login} value={target.login}>
              {target.login} · {target.scope_label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder={namePlaceholder}
        aria-label="New project name"
        aria-invalid={availability === "invalid" || availability === "taken"}
        className="border-border bg-secondary text-secondary-foreground placeholder:text-muted-foreground focus-visible:ring-ring/50 h-8 w-56 max-w-full min-w-0 flex-1 rounded-md border px-2 text-xs outline-none focus-visible:ring-2"
      />
    </>
  );
}

/**
 * Validation / availability line for the new-project controls. Rendered as a
 * full-width row under the whole project row so a long message reads from the
 * start of the row instead of hanging off the owner select.
 */
export function NewProjectStatus({
  ownerLogin,
  ownersError,
  ownersAction,
  nameValidation,
  availability,
}: {
  ownerLogin: string;
  ownersError: string | null;
  ownersAction: { href: string; label: string } | null;
  nameValidation: GithubRepoNameValidation;
  availability: AvailabilityState;
}) {
  return (
    <div className="min-h-4 text-[11px] leading-4" aria-live="polite">
      {ownersError ? (
          <span className="text-accent-red">
            {ownersError}
            {ownersAction ? (
              <>
                {" "}
                <a className="underline" href={ownersAction.href}>
                  {ownersAction.label}
                </a>
              </>
            ) : null}
          </span>
        ) : !nameValidation.ok ? (
          <span className="text-accent-red">{nameValidation.message}</span>
        ) : (
          <>
            {nameValidation.normalized ? (
              <span className="text-muted-foreground mr-2">
                Will create as {nameValidation.name}.
              </span>
            ) : null}
            {availability === "checking" ? (
              <span className="text-muted-foreground">
                Checking {ownerLogin}/{nameValidation.name}…
              </span>
            ) : availability === "available" ? (
              <span className="text-accent-green">
                {ownerLogin}/{nameValidation.name} is available.
              </span>
            ) : availability === "taken" ? (
              <span className="text-accent-red">
                {ownerLogin}/{nameValidation.name} already exists.
              </span>
            ) : availability === "unverified" ? (
              <span className="text-accent-amber">
                Availability could not be verified. You can still try.
              </span>
            ) : null}
          </>
        )}
    </div>
  );
}
