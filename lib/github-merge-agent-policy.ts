import * as Sentry from "@sentry/nextjs";
import type { AutoMergeOutcome } from "./github-merge";
import {
  enforceMergePolicy,
  type MergePolicyDeps,
} from "./github-merge-policy";
import { defaultMergePolicyDeps } from "./github-merge-policy-store";
import { recordTeamAuditEvent } from "./team-audit";

/** Trusted server context, never model-supplied merge arguments. */
export type AgentMergePolicyScope = {
  userId: string;
  teamId?: string | null;
  contextRepo?: { id?: string | null; owner?: string; repo?: string };
  aiCallId?: string | null;
  requestId?: string | null;
  deps?: MergePolicyDeps;
  recordAuditEvent?: typeof recordTeamAuditEvent;
  deferUntilReviewComplete?: (target: {
    prNumber: number;
    expectedHeadSha: string | null;
    commitTitle?: string;
  }) => void;
};

type Target = {
  owner: string;
  repo: string;
  prNumber: number;
  expectedHeadSha?: string;
  commitTitle?: string;
  requireImmediateMerge?: boolean;
  mergePolicyScope?: AgentMergePolicyScope;
};

async function recordAttempt(
  scope: AgentMergePolicyScope,
  target: Target,
  outcome: AutoMergeOutcome,
  decision: string,
  approvalId?: string
) {
  const targetId = `${target.owner}/${target.repo}#${target.prNumber}`;
  const payload = {
    target_owner: target.owner,
    target_repo: target.repo,
    head_sha: target.expectedHeadSha ?? null,
    ...(approvalId ? { approval_id: approvalId } : {}),
  };
  if (!scope.teamId) {
    console.info("[github-merge] attempt", {
      userId: scope.userId,
      aiCallId: scope.aiCallId ?? null,
      requestId: scope.requestId ?? null,
      target: targetId,
      decision,
      ...payload,
    });
    return;
  }
  const contextIsTarget =
    scope.contextRepo?.owner?.toLowerCase() === target.owner.toLowerCase() &&
    scope.contextRepo?.repo?.toLowerCase() === target.repo.toLowerCase();
  try {
    const result = await (scope.recordAuditEvent ?? recordTeamAuditEvent)({
      productTeamId: scope.teamId,
      actorUserId: scope.userId,
      action: "github.pull_request.merge",
      decisionCode: decision,
      targetType: "github_pull_request",
      targetId,
      correlations: {
        aiCallId: scope.aiCallId ?? null,
        requestId: scope.requestId ?? null,
        repoId: contextIsTarget ? (scope.contextRepo?.id ?? null) : null,
      },
      payload: {
        ...payload,
        merged: outcome.merged,
        queued: outcome.queued === true,
      },
    });
    if (result.ok) return;
  } catch {
    /* Merge outcome remains authoritative if audit storage fails. */
  }
  Sentry.captureMessage("github merge audit event was not recorded", {
    level: "warning",
    extra: { teamId: scope.teamId, target: targetId, decision },
  });
}

/** Shared boundary for native reviewer and post-run flow merge paths. */
export async function withAgentMergePolicy(
  target: Target,
  mode: "merge" | "queue",
  execute: (immediateOnly: boolean) => Promise<AutoMergeOutcome>
): Promise<AutoMergeOutcome> {
  const scope = target.mergePolicyScope;
  if (!scope) return execute(target.requireImmediateMerge === true);
  const policy = scope.teamId
    ? await enforceMergePolicy(
        {
          userId: scope.userId,
          teamId: scope.teamId,
          owner: target.owner,
          repo: target.repo,
          number: target.prNumber,
          expectedHeadSha: target.expectedHeadSha ?? "",
          commitTitle: target.commitTitle,
          aiCallId: scope.aiCallId,
          requestId: scope.requestId,
        },
        scope.contextRepo,
        scope.deps ?? defaultMergePolicyDeps,
        scope.deferUntilReviewComplete ? "review" : mode
      )
    : { allowed: true as const };
  if (!policy.allowed) {
    if (policy.decision === "merge_deferred") {
      scope.deferUntilReviewComplete?.({
        prNumber: target.prNumber,
        expectedHeadSha: target.expectedHeadSha ?? null,
        commitTitle: target.commitTitle,
      });
    }
    const outcome = {
      merged: false,
      reason: policy.error,
      approvalId: policy.approvalId,
    };
    await recordAttempt(
      scope,
      target,
      outcome,
      policy.decision,
      policy.approvalId
    );
    return outcome;
  }
  const approvalId = "approvalId" in policy ? policy.approvalId : undefined;
  try {
    const outcome = await execute(
      target.requireImmediateMerge === true ||
        ("immediateOnly" in policy && policy.immediateOnly === true)
    );
    await recordAttempt(
      scope,
      target,
      outcome,
      outcome.merged
        ? "merged"
        : outcome.queued
          ? "auto_merge_queued"
          : "not_merged",
      approvalId
    );
    return { ...outcome, ...(approvalId ? { approvalId } : {}) };
  } catch (error) {
    await recordAttempt(
      scope,
      target,
      { merged: false, reason: "GitHub merge failed" },
      "not_merged",
      approvalId
    );
    throw error;
  }
}
