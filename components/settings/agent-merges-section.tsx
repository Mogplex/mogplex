"use client";

import { useState } from "react";
import useSWR from "swr";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { TeamMergePolicyResponse } from "@/lib/github-merge-policy-handlers";
import type { TeamMergePolicy } from "@/lib/github-merge-policy";

export function AgentMergesSection({ teamId }: { teamId: string }) {
  const endpoint = `/api/teams/${teamId}/agent-merges`;
  const { data, error, mutate } = useSWR<TeamMergePolicyResponse>(endpoint,
    (url: string) => fetchJsonObject<TeamMergePolicyResponse>(url, "Unable to load agent merge settings")
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(policy: Partial<TeamMergePolicy>) {
    setBusy(true);
    setMessage(null);
    setSaveError(null);
    try {
      const saved = await fetchJsonObject<TeamMergePolicyResponse>(endpoint,
        "Unable to save agent merge settings", {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy),
        });
      await mutate(saved, { revalidate: false });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Unable to save agent merge settings");
    } finally { setBusy(false); }
  }

  async function resolve(id: string, approved: boolean) {
    setBusy(true);
    setMessage(null);
    setSaveError(null);
    try {
      await fetchJsonObject(`${endpoint}/${id}`, "Unable to save merge approval", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved }),
      });
      await mutate();
      setMessage(approved ? "Approved. Ask your agent to continue." : "Denied. This request cannot be used to merge.");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Unable to save merge approval");
    } finally { setBusy(false); }
  }

  return (
    <section className="border border-border/60 bg-card px-5 py-5 space-y-4">
      <div>
        <h2 className="ui-section-title">Agent merges</h2>
        <p className="ui-section-caption">Both controls are off by default. Only a team owner or admin can change them.</p>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-foreground">Require merge approval</div>
          <p className="text-sm text-muted-foreground">Review requests from Mogplex merge tools before they proceed. Each approval permits one try at a direct merge. It applies only to the head shown below.</p>
          <p className="text-sm text-muted-foreground">Wait for required checks and reviews before approval. If the merge fails, approve a new request. With this control on, Mogplex tools cannot enable auto-merge.</p>
        </div>
        <Switch aria-label="Require merge approval" checked={data?.policy.requireApproval ?? false}
          disabled={!data || !data.viewer.canManage || busy}
          onCheckedChange={requireApproval => data && void save({ requireApproval })} />
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-foreground">Merge only in the run&apos;s repository</div>
          <p className="text-sm text-muted-foreground">An agent can merge only in the repository its run belongs to. A run without a repository cannot merge.</p>
        </div>
        <Switch aria-label="Merge only in the run's repository" checked={data?.policy.contextRepoOnly ?? false}
          disabled={!data || !data.viewer.canManage || busy}
          onCheckedChange={contextRepoOnly => data && void save({ contextRepoOnly })} />
      </div>
      <p className="text-sm text-muted-foreground">These controls apply to Mogplex merge tools and flow merge actions. Approval is most useful when a repository has no required checks or reviews. GitHub still enforces protection rules for branches. Select Refresh requests to see requests from chat, Slack, CLI runs, or flows.</p>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium text-foreground">Your merge requests</h3>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void mutate()}>Refresh requests</Button>
      </div>
      {data?.approvals.length === 0 && <p className="text-sm text-muted-foreground">No merge requests need your approval.</p>}
      {data?.approvals.map(approval => (
        <div key={approval.id} className="space-y-2 border border-border/60 px-3 py-3">
          <a className="text-sm text-foreground underline" target="_blank" rel="noreferrer"
            href={`https://github.com/${encodeURIComponent(approval.target_owner)}/${encodeURIComponent(approval.target_repo)}/pull/${approval.pr_number}`}>
            {approval.target_owner}/{approval.target_repo} #{approval.pr_number}
          </a>
          <div className="break-all font-mono text-xs text-muted-foreground">Head: {approval.head_sha}</div>
          {approval.commit_title && <p className="text-sm text-muted-foreground">Commit title: {approval.commit_title}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void resolve(approval.id, true)}
              aria-label={`Approve merge of ${approval.target_owner}/${approval.target_repo} #${approval.pr_number}`}>Approve merge</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void resolve(approval.id, false)}
              aria-label={`Deny merge of ${approval.target_owner}/${approval.target_repo} #${approval.pr_number}`}>Deny merge</Button>
          </div>
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-destructive">Unable to load agent merge settings.</p>}
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
