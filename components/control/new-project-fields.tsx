"use client";

import type { GithubRepoNameValidation } from "@/lib/github-repo-name";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type GithubOwnerTarget = {
  login: string;
  kind: "personal" | "org";
  github_installation_id: number | null;
  scope_label: string;
  source: "oauth" | "installation" | "oauth+installation";
};

export type AvailabilityState =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "unverified"
  | "invalid";

export function NewProjectFields({
  ownerTargets,
  ownerLogin,
  onOwnerChange,
  ownersLoading,
  ownersError,
  name,
  onNameChange,
  namePlaceholder,
  nameValidation,
  availability,
}: {
  ownerTargets: GithubOwnerTarget[];
  ownerLogin: string;
  onOwnerChange: (value: string) => void;
  ownersLoading: boolean;
  ownersError: string | null;
  name: string;
  onNameChange: (value: string) => void;
  namePlaceholder: string;
  nameValidation: GithubRepoNameValidation;
  availability: AvailabilityState;
}) {
  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <div className="flex flex-wrap gap-2">
        <Select
          value={ownerLogin}
          onValueChange={onOwnerChange}
          disabled={ownersLoading || ownerTargets.length === 0}
        >
          <SelectTrigger
            aria-label="GitHub owner"
            className="border-border bg-secondary text-secondary-foreground h-8 w-44 px-2 text-xs font-medium shadow-none"
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
          className="border-border bg-secondary text-secondary-foreground placeholder:text-muted-foreground focus-visible:ring-ring/50 h-8 w-56 rounded-md border px-2 text-xs outline-none focus-visible:ring-2"
        />
      </div>
      <div className="min-h-4 text-[11px] leading-4" aria-live="polite">
        {ownersError ? (
          <span className="text-accent-red">{ownersError}</span>
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
    </div>
  );
}
