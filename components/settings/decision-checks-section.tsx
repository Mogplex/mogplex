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
    <section className="border border-border/60 bg-card">
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
      <div className="space-y-2 px-5 pb-5 text-sm text-muted-foreground">
        <p>
          While an agent works, a small evaluation model judges what it is
          doing: whether a shell command would destroy something remote,
          whether a command that reported success actually failed, and whether
          the agent&apos;s final claims match what its tools did. It also
          notes which of the memories and agent skills loaded for a request
          the request needed, without changing what is loaded. The same model
          answers Classify nodes in automations.
        </p>
        <p>
          When this is on, short excerpts of commands, tool output, the
          agent&apos;s final message, and your request with the memories and
          skill summaries loaded for it are sent to that model with secrets
          removed. When it is off, nothing is sent, destructive commands no
          longer pause for approval through this check, and Classify nodes
          fail instead of choosing a branch. A change can take up to 30
          seconds to reach runs already in progress.
        </p>
        {error ? (
          <p className="text-destructive">Unable to load this setting.</p>
        ) : null}
        {saveError ? <p className="text-destructive">{saveError}</p> : null}
      </div>
    </section>
  );
}
