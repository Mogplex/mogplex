"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ApiKeyAccessOptions,
  type ApiKeyAccessOption,
} from "@/components/settings/api-key-access-options";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { ApiKeyAccess } from "@/lib/mogplex-api/key-access";

type TeamApiKeyAccessResponse = {
  access: ApiKeyAccess;
  viewer: { canManage: boolean };
};

/** The team owner's two choices, for every member's keys on this team. */
const TEAM_ACCESS_OPTIONS: readonly ApiKeyAccessOption[] = [
  {
    value: "full",
    label: "Each key's own access",
    description:
      "A member's key can do what its owner allows. Full-access keys can start runs and sandboxes on this team's repositories directly.",
  },
  {
    value: "automations",
    label: "Automations only",
    description:
      "Every member's key starts work on this team's repositories only by triggering an automation that has an API trigger, whatever the key allows. Signing in to Mogplex, and the CLI or MCP clients logged in with OAuth, are not affected.",
  },
];

/**
 * Whether members' Mogplex API keys may act directly on the team's
 * repositories. Only a team owner can change it; everyone else sees it.
 */
export function TeamApiKeyAccessSection({ teamId }: { teamId: string }) {
  const endpoint = `/api/teams/${teamId}/api-key-access`;
  const { data, error, mutate } = useSWR<TeamApiKeyAccessResponse>(
    endpoint,
    (url: string) =>
      fetchJsonObject<TeamApiKeyAccessResponse>(
        url,
        "Unable to load API key access"
      )
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canManage = data?.viewer.canManage === true;

  async function save(access: ApiKeyAccess) {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await fetchJsonObject<TeamApiKeyAccessResponse>(
        endpoint,
        "Unable to save API key access",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access }),
        }
      );
      await mutate(saved, { revalidate: false });
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Unable to save API key access"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Mogplex API keys</div>
        <div className="ui-section-caption">
          Applies to every member&apos;s Mogplex keys on this team&apos;s
          repositories. Only a team owner can change it.
        </div>
      </div>
      <div className="space-y-2 px-5 pb-5">
        <ApiKeyAccessOptions
          idPrefix={`team-${teamId}-key-access`}
          label="Mogplex API key access for this team"
          options={TEAM_ACCESS_OPTIONS}
          value={data?.access ?? "full"}
          onChange={(access) => void save(access)}
          disabled={!data || !canManage || saving}
        />
        {error ? (
          <p className="text-sm text-destructive">
            Unable to load this setting.
          </p>
        ) : null}
        {saveError ? (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
