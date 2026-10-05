import assert from "node:assert/strict";
import test from "node:test";
import type { RecordTeamAuditEventInput } from "@/lib/team-audit";
import {
  loadToolsModule,
  withPatchedFetch,
} from "./helpers/agents-tools-fixtures";
import {
  mergeFetch,
  REVIEWED_HEAD_SHA,
  withAcmeInstallation,
  type MergeExecute,
  type MergeFetchCall,
} from "./helpers/github-pr-merge-fixtures";

const target = {
  owner: "acme",
  repo: "widgets",
  number: 84,
  expectedHeadSha: REVIEWED_HEAD_SHA,
};
type Policy = { requireApproval: boolean; contextRepoOnly: boolean };
type GateDeps = {
  read: (userId: string, teamId: string) => Promise<Policy>;
  claimApproval: (input: unknown) => Promise<string | null>;
  requestApproval: (input: unknown) => Promise<string>;
};

async function run(input: {
  policy?: Policy;
  contextRepo?: string | null;
  approvalId?: string | null;
  failRead?: boolean;
  failClaim?: boolean;
  calls?: MergeFetchCall[];
}) {
  const calls = input.calls ?? [];
  const events: RecordTeamAuditEventInput[] = [];
  let result: unknown;
  let requested = 0;
  await withAcmeInstallation(async () =>
    withPatchedFetch(mergeFetch(calls), async () => {
      const { createGithubPullRequestMergeTool } = await loadToolsModule();
      const options: NonNullable<
        Parameters<typeof createGithubPullRequestMergeTool>[0]
      > & { mergePolicyDeps: GateDeps } = {
        userId: "user-1",
        teamId: "team-1",
        aiCallId: "call-1",
        contextRepo:
          input.contextRepo === null
            ? undefined
            : { owner: "acme", repo: input.contextRepo ?? "widgets" },
        recordAuditEvent: async (event) => {
          events.push(event);
          return { ok: true };
        },
        mergePolicyDeps: {
          read: async () => {
            if (input.failRead) throw new Error("private database diagnostic");
            return (
              input.policy ?? { requireApproval: false, contextRepoOnly: false }
            );
          },
          claimApproval: async () => {
            if (input.failClaim) throw new Error("private approval diagnostic");
            return input.approvalId ?? null;
          },
          requestApproval: async () => {
            requested += 1;
            return "approval-1";
          },
        },
      };
      const tool = createGithubPullRequestMergeTool(options) as unknown as {
        execute: MergeExecute;
      };
      result = await tool.execute(target);
    })
  );
  return {
    calls,
    events,
    result: result as {
      error?: string;
      approvalId?: string;
      merged?: boolean;
    },
    requested,
  };
}

test("team approval enabled blocks a direct execute call before any GitHub request", async () => {
  const result = await run({
    policy: { requireApproval: true, contextRepoOnly: false },
  });
  assert.equal(result.result.approvalId, "approval-1");
  assert.equal(result.events[0].decisionCode, "approval_required");
  assert.equal(result.requested, 1);
  assert.deepEqual(result.calls, []);
});

test("a claimed human approval permits the existing exact-head protected merge", async () => {
  const result = await run({
    policy: { requireApproval: true, contextRepoOnly: true },
    approvalId: "approval-approved",
  });
  assert.equal(result.result.merged, true);
  assert.equal(result.requested, 0);
  assert.equal(result.calls.at(-1)?.path, "/repos/acme/widgets/pulls/84/merge");
  assert.equal(result.events[0].payload?.approval_id, "approval-approved");
});

test("context-only policy refuses missing or different run repositories even with approval", async () => {
  for (const contextRepo of [null, "different"]) {
    const result = await run({
      policy: { requireApproval: true, contextRepoOnly: true },
      contextRepo,
      approvalId: "approved",
    });
    assert.equal(result.events[0].decisionCode, "outside_context_repo");
    assert.deepEqual(result.calls, []);
    assert.equal(result.requested, 0);
  }
});

test("default-off policy preserves cross-repository conversation-based merges", async () => {
  assert.equal((await run({ contextRepo: "different" })).result.merged, true);
});

test("unavailable policy or approval storage never falls back to a merge", async () => {
  for (const failure of [{ failRead: true }, { failClaim: true }]) {
    const result = await run({
      policy: { requireApproval: true, contextRepoOnly: false },
      ...failure,
    });
    assert.equal(result.events[0].decisionCode, "merge_policy_unavailable");
    assert.deepEqual(result.calls, []);
    assert.ok(!result.result.error?.includes("private"));
  }
});
