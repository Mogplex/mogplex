"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  githubManifestFormAction,
  validateGithubAppName,
  type GithubAppManifest,
} from "@/lib/setup/github-app-manifest";

type GithubManifestFormProps = {
  manifest: GithubAppManifest;
  state: string;
  defaultName: string;
};

/**
 * Posts the App manifest to GitHub, which creates the App after the user
 * confirms and redirects back with a one-time code.
 */
export function GithubManifestForm({
  manifest,
  state,
  defaultName,
}: GithubManifestFormProps) {
  const nameId = useId();
  const orgId = useId();
  const [name, setName] = useState(defaultName);
  const [organization, setOrganization] = useState("");

  const nameError = validateGithubAppName(name);
  const action = githubManifestFormAction(state, organization);
  const manifestJson = useMemo(
    () => JSON.stringify({ ...manifest, name: name.trim() }),
    [manifest, name]
  );

  return (
    <form method="post" action={action ?? undefined} className="space-y-4">
      <input type="hidden" name="manifest" value={manifestJson} />
      <div className="space-y-2">
        <Label htmlFor={nameId}>GitHub App name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={`${nameId}-hint`}
          required
        />
        <p id={`${nameId}-hint`} className="text-muted-foreground text-xs">
          {nameError ?? "App names are unique across GitHub."}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={orgId}>Organization (optional)</Label>
        <Input
          id={orgId}
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
          placeholder="acme"
          autoComplete="off"
          aria-invalid={action ? undefined : true}
          aria-describedby={`${orgId}-hint`}
        />
        <p id={`${orgId}-hint`} className="text-muted-foreground text-xs">
          {action
            ? "Leave empty to create the App on your personal account."
            : "Enter a valid GitHub organization login."}
        </p>
      </div>
      <Button type="submit" disabled={!action || Boolean(nameError)}>
        Create GitHub App on GitHub
      </Button>
    </form>
  );
}
