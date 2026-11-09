"use client";

import { useState } from "react";
import useSWR from "swr";
import { Switch } from "@/components/ui/switch";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { DecisionChecksResponse } from "@/lib/decisions/account-setting-handlers";

type DecisionChecksSectionProps = {
  /** `/api/settings/decision-checks` or the team's equivalent. */
  endpoint: string;
  /** Who the choice covers, for the caption. */
  audience: "team" | "personal";
};

const CAPTIONS: Record<DecisionChecksSectionProps["audience"], string> = {
  team: "Applies to everyone's work in this team. Only an owner or admin can change it.",
  personal:
    "Applies to your work outside a team. Each team has its own setting.",
};

/**
 * One switch for the whole decision layer. The copy says what is sent and
 * what stops working, because turning it off also removes a safety check.
 */
export function DecisionChecksSection({
  endpoint,
  audience,
}: DecisionChecksSectionProps) {
  const { data, error, mutate } = useSWR<DecisionChecksResponse>(
    endpoint,
    (url: string) =>
      fetchJsonObject<DecisionChecksResponse>(url, "Unable to load run checks")
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canManage = data?.viewer.canManage === true;

  async function save(enabled: boolean) {
    if (!data) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await fetchJsonObject<DecisionChecksResponse>(
        endpoint,
        "Unable to save run checks",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        }
      );
      await mutate(saved, { revalidate: false });
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Unable to save run checks"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-2">
        <div>
          <div className="ui-section-title">Run checks</div>
          <div className="ui-section-caption">{CAPTIONS[audience]}</div>
        </div>
        <Switch
          aria-label="Run checks"
          checked={data?.enabled ?? false}
          disabled={!data || !canManage || saving}
          onCheckedChange={(checked) => void save(checked)}
        />
      </div>
      <dl className="grid gap-x-4 gap-y-2 px-5 pb-5 text-sm text-muted-foreground sm:grid-cols-[max-content_1fr]">
        <dt className="text-foreground">What it does</dt>
        <dd>
          A small model checks agent work as it runs. It pauses destructive
          commands for your approval, catches commands that report success
          but failed, and flags final claims that the tool results do not
          support. It also answers Classify nodes in automations.
        </dd>
        <dt className="text-foreground">What is sent</dt>
        <dd>
          Short excerpts of commands, tool output, and the agent&apos;s final
          message. Also your request, the memories loaded for it, and
          summaries of the skills available to it. Secrets are removed.
        </dd>
        <dt className="text-foreground">When it is off</dt>
        <dd>
          Nothing is sent. Destructive commands do not pause through this
          check, and Classify nodes fail instead of choosing a branch. A
          change reaches runs in progress within 30 seconds.
        </dd>
      </dl>
      <div className="space-y-2 px-5 pb-5 text-sm empty:hidden">
        {error ? (
          <p className="text-destructive">Unable to load this setting.</p>
        ) : null}
        {saveError ? <p className="text-destructive">{saveError}</p> : null}
      </div>
    </section>
  );
}
