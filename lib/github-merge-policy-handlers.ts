import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { requireProfileId } from "@/lib/auth";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import { isUuid } from "@/lib/uuid";
import {
  listMergeApprovals,
  readTeamMergePolicy,
  resolveMergeApproval,
  writeTeamMergePolicy,
  type MergeApprovalRequest,
} from "./github-merge-policy-store";
import type { TeamMergePolicy } from "./github-merge-policy";

export type TeamMergePolicyResponse = {
  policy: TeamMergePolicy;
  approvals: MergeApprovalRequest[];
  viewer: { canManage: boolean };
};

export type MergeSettingsDeps = {
  requireProfileId: typeof requireProfileId;
  loadTeamMembershipAuth: typeof loadTeamMembershipAuth;
  read: typeof readTeamMergePolicy;
  write: typeof writeTeamMergePolicy;
  list: typeof listMergeApprovals;
  resolve: typeof resolveMergeApproval;
  audit: typeof recordTeamAuditEvent;
  reportAuditFailure: (extra: Record<string, unknown>) => void;
};

const defaults: MergeSettingsDeps = {
  requireProfileId,
  loadTeamMembershipAuth,
  read: readTeamMergePolicy,
  write: writeTeamMergePolicy,
  list: listMergeApprovals,
  resolve: resolveMergeApproval,
  audit: recordTeamAuditEvent,
  reportAuditFailure: (extra) => {
    Sentry.captureMessage("github merge setting audit was not recorded", {
      level: "warning",
      extra,
    });
  },
};

const policyBody = z
  .object({
    requireApproval: z.boolean(),
    contextRepoOnly: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const resolutionBody = z.object({ approved: z.boolean() }).strict();

export function createMergeSettingsHandlers(
  overrides: Partial<MergeSettingsDeps> = {}
) {
  const deps = { ...defaults, ...overrides };
  async function audit(event: Parameters<typeof recordTeamAuditEvent>[0]) {
    try {
      if ((await deps.audit(event)).ok) return;
    } catch {
      /* Preserve the successful setting or approval write. */
    }
    deps.reportAuditFailure({
      action: event.action,
      teamId: event.productTeamId,
      targetId: event.targetId,
    });
  }
  async function access(teamId: string) {
    const userId = await deps.requireProfileId();
    if (userId instanceof Response) return userId;
    const auth = await deps.loadTeamMembershipAuth(teamId, userId);
    if (!auth.ok)
      return Response.json({ error: auth.error }, { status: auth.status });
    return { userId, canManage: auth.canManage };
  }
  function failure(operation: string, error: unknown) {
    console.error(`[github-merge] ${operation} failed`, { error });
    return Response.json(
      {
        error:
          "Unable to load or save agent merge settings. No merge was started.",
      },
      { status: 500 }
    );
  }
  return {
    async get(teamId: string) {
      const auth = await access(teamId);
      if (auth instanceof Response) return auth;
      try {
        const [policy, approvals] = await Promise.all([
          deps.read(teamId),
          deps.list(auth.userId, teamId),
        ]);
        if (!policy)
          return Response.json({ error: "Team not found" }, { status: 404 });
        return Response.json({
          policy,
          approvals,
          viewer: { canManage: auth.canManage },
        } satisfies TeamMergePolicyResponse);
      } catch (error) {
        return failure("load settings", error);
      }
    },
    async patch(request: Request, teamId: string) {
      const auth = await access(teamId);
      if (auth instanceof Response) return auth;
      if (!auth.canManage)
        return Response.json({ error: "Forbidden" }, { status: 403 });
      const parsed = policyBody.safeParse(
        await request.json().catch(() => null)
      );
      if (!parsed.success)
        return Response.json(
          {
            error: "requireApproval and contextRepoOnly must be true or false",
          },
          { status: 422 }
        );
      try {
        const previous = await deps.read(teamId);
        if (!previous || !(await deps.write(teamId, parsed.data)))
          return Response.json({ error: "Team not found" }, { status: 404 });
        const policy = await deps.read(teamId);
        if (!policy)
          return Response.json({ error: "Team not found" }, { status: 404 });
        const from = {
          ...(parsed.data.requireApproval === undefined
            ? {}
            : { requireApproval: previous.requireApproval }),
          ...(parsed.data.contextRepoOnly === undefined
            ? {}
            : { contextRepoOnly: previous.contextRepoOnly }),
        };
        if (
          (parsed.data.requireApproval !== undefined &&
            previous.requireApproval !== parsed.data.requireApproval) ||
          (parsed.data.contextRepoOnly !== undefined &&
            previous.contextRepoOnly !== parsed.data.contextRepoOnly)
        ) {
          await audit({
            productTeamId: teamId,
            actorUserId: auth.userId,
            action: "github.merge_policy.changed",
            targetType: "team",
            targetId: teamId,
            payload: { from, to: parsed.data },
          });
        }
        return Response.json({
          policy,
          approvals: await deps.list(auth.userId, teamId),
          viewer: { canManage: true },
        } satisfies TeamMergePolicyResponse);
      } catch (error) {
        return failure("save settings", error);
      }
    },
    async resolve(request: Request, teamId: string, approvalId: string) {
      const auth = await access(teamId);
      if (auth instanceof Response) return auth;
      if (!isUuid(approvalId))
        return Response.json({ error: "Invalid approval ID" }, { status: 422 });
      const parsed = resolutionBody.safeParse(
        await request.json().catch(() => null)
      );
      if (!parsed.success)
        return Response.json(
          { error: "approved must be true or false" },
          { status: 422 }
        );
      try {
        const ok = await deps.resolve({
          userId: auth.userId,
          teamId,
          approvalId,
          approved: parsed.data.approved,
        });
        if (!ok)
          return Response.json(
            { error: "This approval is no longer pending" },
            { status: 409 }
          );
        await audit({
          productTeamId: teamId,
          actorUserId: auth.userId,
          action: "github.merge_approval.resolved",
          targetType: "merge_approval",
          targetId: approvalId,
          payload: { approved: parsed.data.approved },
        });
        return Response.json({ ok: true });
      } catch (error) {
        return failure("resolve approval", error);
      }
    },
  };
}
