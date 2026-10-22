import assert from "node:assert/strict";
import { test } from "vitest";
import type { RecordTeamAuditEventInput } from "@/lib/team-audit";
import {
  loadToolsModule,
  withPatchedFetch,
} from "@/tests/unit/helpers/agents-tools-fixtures";
import {
  mergeFetch,
  REVIEWED_HEAD_SHA,
  withAcmeInstallation,
  type MergeExecute,
  type MergeFetchCall,
} from "@/tests/unit/helpers/github-pr-merge-fixtures";

const target = {
  owner: "acme",
  repo: "widgets",
  number: 84,
  expectedHeadSha: REVIEWED_HEAD_SHA,
};
type Policy = { requireApproval: boolean; contextRepoOnly: boolean };
type GateDeps = {
  read: (userId: string, teamId: string) => Promise<Policy>;
};

async function run(input: {
  policy?: Policy;
  contextRepo?: string | null;
  failRead?: boolean;
  calls?: MergeFetchCall[];
}) {
  const calls = input.calls ?? [];
  const events: RecordTeamAuditEventInput[] = [];
  let result: unknown;
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
  };
}

test("retired approval settings no longer block a user-requested merge", async () => {
  const result = await run({
    policy: { requireApproval: true, contextRepoOnly: false },
  });
  assert.equal(result.result.merged, true);
  assert.equal(result.result.approvalId, undefined);
  assert.equal(result.events[0].decisionCode, "merged");
});

test("exact-head protected merges do not claim an old human approval", async () => {
  const result = await run({
    policy: { requireApproval: true, contextRepoOnly: true },
  });
  assert.equal(result.result.merged, true);
  assert.equal(result.calls.at(-1)?.path, "/repos/acme/widgets/pulls/84/merge");
  assert.equal(result.events[0].payload?.approval_id, undefined);
});

test("retired repository settings do not block missing or different run context", async () => {
  for (const contextRepo of [null, "different"]) {
    const result = await run({
      policy: { requireApproval: true, contextRepoOnly: true },
      contextRepo,
    });
    assert.equal(result.result.merged, true);
    assert.equal(result.events[0].decisionCode, "merged");
  }
});

test("default-off policy preserves cross-repository conversation-based merges", async () => {
  assert.equal((await run({ contextRepo: "different" })).result.merged, true);
});

test("unavailable team permission never falls back to a merge", async () => {
  for (const failure of [{ failRead: true }]) {
    const result = await run({
      policy: { requireApproval: true, contextRepoOnly: false },
      ...failure,
    });
    assert.equal(result.events[0].decisionCode, "merge_policy_unavailable");
    assert.deepEqual(result.calls, []);
    assert.ok(!result.result.error?.includes("private"));
  }
});
