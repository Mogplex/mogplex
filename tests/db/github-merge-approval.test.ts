import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ToolSet } from "ai";
import { buildFlowPRReviewTools } from "@/lib/workflows/automation-pr-review-tools";
import type {
  JobContext,
  FlowAutoMergeRequest,
} from "@/lib/workflows/automation-job-types";
import {
  attemptFlowAutoMerge,
  flowMergePolicyScope,
} from "@/lib/workflows/automation-job-auto-merge";
import { createMergeSettingsHandlers } from "@/lib/github-merge-policy-handlers";
import {
  defaultMergePolicyDeps,
  listMergeApprovals,
  readTeamMergePolicy,
  resolveMergeApproval,
  writeTeamMergePolicy,
} from "@/lib/github-merge-policy-store";
import {
  enforceMergePolicy,
  type MergeApprovalTarget,
} from "@/lib/github-merge-policy";

const owner = "00000000-0000-4000-8000-000000000060";
const developer = "00000000-0000-4000-8000-000000000061";
const other = "00000000-0000-4000-8000-000000000062";
const team = "00000000-0000-4000-8000-000000000071";
const otherTeam = "00000000-0000-4000-8000-000000000072";
const missingTeam = "00000000-0000-4000-8000-000000000073";
const target: MergeApprovalTarget = {
  userId: developer,
  teamId: team,
  owner: "acme",
  repo: "widgets",
  number: 84,
  expectedHeadSha: "a".repeat(40),
  commitTitle: "Approved title",
};
let db: PGlite;
const previous = new Map<string, PropertyDescriptor | undefined>();

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: SHIM_TYPE_PARSERS,
  });
  const warnings: string[] = [];
  const migrations = await applyNeonMigrations(db, {
    log: () => {},
    warn: (message) => warnings.push(message),
  });
  expect(migrations.ok, warnings.join("\n")).toBe(true);
  await db.query("insert into profiles(id) values ($1),($2),($3)", [
    owner,
    developer,
    other,
  ]);
  await db.query(
    "insert into teams(id,name,slug,owner_user_id) values ($1,'Merges','merge-team',$3),($2,'Other','other-merge-team',$3)",
    [team, otherTeam, owner]
  );
  await db.query(
    "insert into team_members(team_id,user_id,role) values ($1,$2,'developer'),($1,$3,'developer')",
    [team, developer, other]
  );
  const shim = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
    }),
  });
  for (const key of ["from", "rpc"] as const) {
    previous.set(key, Object.getOwnPropertyDescriptor(supabaseAdmin, key));
    Object.defineProperty(supabaseAdmin, key, {
      configurable: true,
      value: shim[key].bind(shim),
    });
  }
}, 120_000);

afterAll(async () => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(supabaseAdmin, key, descriptor);
    else Reflect.deleteProperty(supabaseAdmin, key);
  }
  await db.close();
});

beforeEach(async () => {
  await db.exec(
    "delete from github_merge_approvals; update teams set github_merge_require_approval=false, github_merge_context_repo_only=false;"
  );
  await db.query(
    "update team_members set role='developer' where team_id=$1 and user_id=$2",
    [team, developer]
  );
});

function handlers(userId = developer) {
  return createMergeSettingsHandlers({
    requireProfileId: async () => userId,
    audit: async () => ({ ok: true }),
  });
}
function request(body: unknown, method = "POST") {
  return new Request("https://mogplex.test/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function approve(id: string) {
  expect(
    (await handlers().resolve(request({ approved: true }), team, id)).status
  ).toBe(200);
}

describe("team merge approvals against the real schema and routes", () => {
  it("rejects a malformed approval ID without changing a pending request", async () => {
    const id = await defaultMergePolicyDeps.requestApproval(target);
    const pending = await listMergeApprovals(developer, team);
    expect(pending.map((row) => row.id)).toEqual([id]);
    const response = await handlers().resolve(
      request({ approved: true }),
      team,
      "not-a-uuid"
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Invalid approval ID" });
    expect(await listMergeApprovals(developer, team)).toEqual(pending);
    expect(await defaultMergePolicyDeps.claimApproval(target)).toBeNull();
  });
  it("server service_role can use approvals while public callers cannot execute the RPC", async () => {
    const result = await db.transaction(async (tx) => {
      await tx.exec("set local row_security=on; set local role service_role");
      return tx.query<{ id: string }>(
        "select public.request_github_merge_approval($1,$2,$3,$4,$5,$6,$7,null,null) as id",
        [
          target.userId,
          target.teamId,
          target.owner,
          target.repo,
          target.number,
          target.expectedHeadSha,
          target.commitTitle,
        ]
      );
    });
    expect(result.rows[0].id).toEqual(expect.any(String));
    await db.exec("create role merge_unauthorized nologin");
    for (const rpc of [
      "request_github_merge_approval",
      "claim_github_merge_approval",
    ]) {
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege('merge_unauthorized', $1, 'EXECUTE') as allowed",
            [`public.${rpc}(uuid,uuid,text,text,integer,text,text,uuid,text)`]
          )
        ).rows[0].allowed
      ).toBe(false);
    }
  });
  it("defaults both controls off and preserves existing team contracts", async () => {
    expect(await readTeamMergePolicy(team)).toEqual({
      requireApproval: false,
      contextRepoOnly: false,
    });
    const result = await db.query<{ name: string; role: string }>(
      "select t.name,m.role from teams t join team_members m on m.team_id=t.id where t.id=$1 and m.user_id=$2",
      [team, owner]
    );
    expect(result.rows).toEqual([{ name: "Merges", role: "owner" }]);
    expect(await defaultMergePolicyDeps.read(developer, team)).toEqual({
      requireApproval: false,
      contextRepoOnly: false,
    });
  });
  it("only an owner/admin can change the team settings", async () => {
    const policy = { requireApproval: true, contextRepoOnly: true };
    expect(
      (await handlers().patch(request(policy, "PATCH"), team)).status
    ).toBe(403);
    const saves = await Promise.all([
      handlers(owner).patch(request({ requireApproval: true }, "PATCH"), team),
      handlers(owner).patch(request({ contextRepoOnly: true }, "PATCH"), team),
    ]);
    expect(saves.map((response) => response.status)).toEqual([200, 200]);
    expect(await readTeamMergePolicy(team)).toEqual(policy);
    expect(await writeTeamMergePolicy(team, { requireApproval: false })).toBe(
      true
    );
    expect(await readTeamMergePolicy(team)).toEqual({
      ...policy,
      requireApproval: false,
    });
    expect(await readTeamMergePolicy(otherTeam)).toEqual({
      requireApproval: false,
      contextRepoOnly: false,
    });
    expect(
      await writeTeamMergePolicy(missingTeam, { requireApproval: true })
    ).toBe(false);
    expect((await handlers(other).get(otherTeam)).status).toBe(403);
  });
  it("deduplicates pending targets, lists only this user's team requests, and requires explicit human resolution", async () => {
    await writeTeamMergePolicy(team, {
      requireApproval: true,
      contextRepoOnly: false,
    });
    const decision = await enforceMergePolicy(
      target,
      undefined,
      defaultMergePolicyDeps
    );
    expect(decision).toMatchObject({
      allowed: false,
      decision: "approval_required",
    });
    const id = await defaultMergePolicyDeps.requestApproval(target);
    expect(decision).toMatchObject({ approvalId: id });
    expect(await defaultMergePolicyDeps.claimApproval(target)).toBeNull();
    expect(await listMergeApprovals(other, team)).toEqual([]);
    expect(await listMergeApprovals(developer, otherTeam)).toEqual([]);
    expect(
      (await listMergeApprovals(developer, team)).map((row) => row.id)
    ).toEqual([id]);
    expect(
      (await handlers(other).resolve(request({ approved: true }), team, id))
        .status
    ).toBe(409);
    await approve(id);
    expect(
      (await handlers().resolve(request({ approved: false }), team, id)).status
    ).toBe(409);
    expect(await defaultMergePolicyDeps.claimApproval(target)).toBe(id);
    expect(await defaultMergePolicyDeps.claimApproval(target)).toBeNull();
    expect(
      (
        await db.query<{ status: string }>(
          "select status from github_merge_approvals where id=$1",
          [id]
        )
      ).rows
    ).toEqual([{ status: "consumed" }]);
  });
  it("binds approval to the exact user, team, owner, repo, number, head, and commit title", async () => {
    const id = await defaultMergePolicyDeps.requestApproval(target);
    await approve(id);
    for (const change of [
      { userId: other },
      { teamId: otherTeam },
      { owner: "different" },
      { repo: "different" },
      { number: 85 },
      { expectedHeadSha: "b".repeat(40) },
      { commitTitle: "Different title" },
    ]) {
      expect(
        await defaultMergePolicyDeps.claimApproval({ ...target, ...change })
      ).toBeNull();
    }
    expect(
      await defaultMergePolicyDeps.claimApproval({
        ...target,
        owner: "ACME",
        repo: "Widgets",
      })
    ).toBe(id);
  });
  it("omitted merge titles stay empty in the approval list and bind a single claim", async () => {
    const untitled = { ...target, commitTitle: undefined };
    const id = await defaultMergePolicyDeps.requestApproval(untitled);
    expect(await listMergeApprovals(developer, team)).toEqual([
      expect.objectContaining({ id, commit_title: "" }),
    ]);
    await approve(id);
    expect(await defaultMergePolicyDeps.claimApproval(target)).toBeNull();
    expect(await defaultMergePolicyDeps.claimApproval(untitled)).toBe(id);
    expect(await defaultMergePolicyDeps.claimApproval(untitled)).toBeNull();
  });
  it("denied requests cannot authorize a merge", async () => {
    const id = await defaultMergePolicyDeps.requestApproval(target);
    expect(
      await resolveMergeApproval({
        userId: developer,
        teamId: team,
        approvalId: id,
        approved: false,
      })
    ).toBe(true);
    expect(await defaultMergePolicyDeps.claimApproval(target)).toBeNull();
  });
  it("rechecks current role and context policy after an approval", async () => {
    const id = await defaultMergePolicyDeps.requestApproval(target);
    await approve(id);
    await writeTeamMergePolicy(team, {
      requireApproval: true,
      contextRepoOnly: true,
    });
    expect(
      await enforceMergePolicy(target, undefined, defaultMergePolicyDeps)
    ).toMatchObject({ allowed: false, decision: "outside_context_repo" });
    await db.query(
      "update team_members set role='viewer' where team_id=$1 and user_id=$2",
      [team, developer]
    );
    expect(
      await enforceMergePolicy(
        target,
        { owner: "acme", repo: "widgets" },
        defaultMergePolicyDeps
      )
    ).toMatchObject({ allowed: false, decision: "merge_policy_unavailable" });
    await db.query(
      "update team_members set role='developer' where team_id=$1 and user_id=$2",
      [team, developer]
    );
    expect(
      await enforceMergePolicy(
        target,
        { owner: "acme", repo: "widgets" },
        defaultMergePolicyDeps
      )
    ).toEqual({ allowed: true, approvalId: id, immediateOnly: true });
  });
  it("at most one simultaneous claim consumes the approved target", async () => {
    const id = await defaultMergePolicyDeps.requestApproval(target);
    await approve(id);
    const claimed = await Promise.all([
      defaultMergePolicyDeps.claimApproval(target),
      defaultMergePolicyDeps.claimApproval(target),
    ]);
    expect(claimed.filter((value) => value === id)).toHaveLength(1);
    expect(claimed.filter((value) => value === null)).toHaveLength(1);
  });
  it("retains existing profile and team deletion through cascading request cleanup", async () => {
    const disposableUser = "00000000-0000-4000-8000-000000000066";
    const disposableTeam = "00000000-0000-4000-8000-000000000077";
    await db.query("insert into profiles(id) values ($1)", [disposableUser]);
    const userRequest = await defaultMergePolicyDeps.requestApproval({
      ...target,
      userId: disposableUser,
    });
    await db.query("delete from profiles where id=$1", [disposableUser]);
    await db.query(
      "insert into teams(id,name,slug,owner_user_id) values ($1,'Disposable','disposable-merge-team',$2)",
      [disposableTeam, owner]
    );
    const teamRequest = await defaultMergePolicyDeps.requestApproval({
      ...target,
      teamId: disposableTeam,
    });
    await db.query("delete from teams where id=$1", [disposableTeam]);
    expect(
      (
        await db.query(
          "select id from github_merge_approvals where id in ($1,$2)",
          [userRequest, teamRequest]
        )
      ).rows
    ).toEqual([]);
  });
  it("production flow reviewer creates a request, requires human resolution, and merges once at the approved head", async () => {
    await writeTeamMergePolicy(team, {
      requireApproval: true,
      contextRepoOnly: true,
    });
    const context: JobContext = {
      metadata: {
        flow_auto_merge: true,
        head_sha: target.expectedHeadSha,
        flow_job_run_id: "run-1",
      },
      assignmentType: "pr_review",
      skillId: null,
      agent: { model: "test-model", system_prompt: null },
      repo: {
        id: "00000000-0000-4000-8000-000000000088",
        user_id: developer,
        full_name: "acme/widgets",
        product_team_id: team,
      },
    };
    const originalFetch = globalThis.fetch;
    const disabledTools = buildFlowPRReviewTools(
      { ...context, metadata: { ...context.metadata, flow_auto_merge: false } },
      "test-token",
      target.number,
      () => {
        throw new Error("Disabled flow must not defer merges");
      }
    );
    expect(Object.keys(disabledTools)).not.toContain("mergePullRequest");
    expect(Object.keys(disabledTools)).not.toContain(
      "queuePullRequestForMerge"
    );
    const writes: string[] = [];
    const pinned: string[] = [];
    globalThis.fetch = async (url, init) => {
      if (init?.method === "PUT") {
        writes.push(String(url));
        pinned.push((JSON.parse(String(init.body)) as { sha: string }).sha);
        return Response.json({ merged: true, sha: "merged" });
      }
      if (init?.method === "POST")
        throw new Error("Approval must never arm auto-merge");
      return Response.json({
        state: "open",
        draft: false,
        mergeable: true,
        mergeable_state: "clean",
        head: { sha: target.expectedHeadSha },
      });
    };
    try {
      const state: { request?: FlowAutoMergeRequest } = {};
      const tools: ToolSet = buildFlowPRReviewTools(
        context,
        "test-token",
        target.number,
        (request) => {
          state.request = request;
        }
      );
      const options = { toolCallId: "merge", messages: [], context: {} };
      const refusedBeforeReport = (await tools.mergePullRequest.execute!(
        {},
        options
      )) as { error: string };
      expect(refusedBeforeReport.error).toMatch(/accepted review report/);
      expect(await listMergeApprovals(developer, team)).toEqual([]);
      await tools.reportReview.execute!(
        { hasIssues: false, summary: "No issues found" },
        options
      );
      const deferred = (await tools.mergePullRequest.execute!(
        { commitTitle: target.commitTitle },
        options
      )) as { merged: boolean; reason: string };
      expect(deferred.merged).toBe(false);
      expect(deferred.reason).toMatch(/review check/);
      expect(writes).toEqual([]);
      expect(await listMergeApprovals(developer, team)).toEqual([]);
      expect(state.request).toEqual({
        prNumber: target.number,
        expectedHeadSha: target.expectedHeadSha,
        commitTitle: target.commitTitle,
      });
      const postRunInput = {
        jobRunId: "run-1",
        repoFullName: context.repo.full_name,
        githubToken: "test-token",
        mergePolicyScope: flowMergePolicyScope(context, "run-1"),
        ...state.request!,
      };
      const pending = await attemptFlowAutoMerge(postRunInput);
      expect(pending.merged).toBe(false);
      expect(await listMergeApprovals(developer, team)).toMatchObject([
        { id: pending.approvalId, head_sha: target.expectedHeadSha },
      ]);
      await approve(pending.approvalId!);
      // A new review still has a pending check: it must preserve approval.
      expect(
        (
          (await tools.mergePullRequest.execute!(
            { commitTitle: target.commitTitle },
            options
          )) as { merged: boolean }
        ).merged
      ).toBe(false);
      expect(
        (
          await db.query<{ status: string }>(
            "select status from github_merge_approvals where id=$1",
            [pending.approvalId]
          )
        ).rows[0].status
      ).toBe("approved");
      const merged = await attemptFlowAutoMerge(postRunInput);
      expect(merged.merged).toBe(true);
      expect(pinned).toEqual([target.expectedHeadSha]);
      expect((await attemptFlowAutoMerge(postRunInput)).merged).toBe(false);
      expect(writes).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
