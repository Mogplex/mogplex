import assert from "node:assert/strict";
import test from "node:test";
import {
  withFetch,
  loadWaitService,
  createLabelWaitCandidate,
} from "./helpers/flow-wait-service-fixtures";

test("resumeFlowWait wins exactly one CAS update and completes the wait token once", async () => {
  const { resumeFlowWait } = await loadWaitService();

  const candidate = createLabelWaitCandidate({
    id: "wait-1",
    labelName: "ready",
    resumeToken: "tok-abc",
  });

  let updateCalls = 0;
  let completeCalls: Array<{ tokenId: string; payload: unknown }> = [];

  await withFetch(
    async ({ url, method }) => {
      if (url.includes("/rest/v1/flow_waits") && method === "PATCH") {
        updateCalls += 1;
        if (updateCalls === 1) {
          return Response.json({ resume_token: candidate.resume_token });
        }
        return Response.json(null, { status: 200 });
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
    async () => {
      const first = await resumeFlowWait(
        {
          candidate,
          payload: { delivery_id: "d-1" },
          deliveryId: "d-1",
        },
        {
          completeWaitToken: async (tokenId, payload) => {
            completeCalls.push({ tokenId, payload });
          },
        }
      );

      const second = await resumeFlowWait(
        {
          candidate,
          payload: { delivery_id: "d-2" },
          deliveryId: "d-2",
        },
        {
          completeWaitToken: async (tokenId, payload) => {
            completeCalls.push({ tokenId, payload });
          },
        }
      );

      assert.deepEqual(first, {
        resumed: true,
        resumeToken: candidate.resume_token,
      });
      assert.equal(second.resumed, false);
      if (!second.resumed) {
        assert.equal(second.reason, "already_resumed");
      }
      assert.equal(completeCalls.length, 1);
      assert.equal(completeCalls[0]?.tokenId, candidate.resume_token);
    }
  );
});

test("resumeFlowWait rolls the row back when wait.completeToken throws", async () => {
  const { resumeFlowWait } = await loadWaitService();

  const candidate = {
    id: "wait-2",
    user_id: "user-1",
    job_run_id: "job-2",
    flow_id: "flow-1",
    installation_id: 99 as number | null,
    repo_id: null,
    node_id: "await-1",
    wait_kind: "github_label_added" as const,
    wait_config: {
      kind: "github_label_added" as const,
      labelName: "ship-it",
      prOnly: true,
    },
    resume_token: "tok-xyz",
  };

  const patchBodies: string[] = [];
  await withFetch(
    async ({ url, method, body }) => {
      if (url.includes("/rest/v1/flow_waits") && method === "PATCH") {
        patchBodies.push(body ?? "");
        if (patchBodies.length === 1) {
          return Response.json({ resume_token: candidate.resume_token });
        }
        return Response.json(null, { status: 200 });
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
    async () => {
      const result = await resumeFlowWait(
        {
          candidate,
          payload: { delivery_id: "d-3" },
          deliveryId: "d-3",
        },
        {
          completeWaitToken: async () => {
            throw new Error("trigger.dev unavailable");
          },
        }
      );

      assert.equal(result.resumed, false);
      if (!result.resumed) {
        assert.equal(result.reason, "complete_failed");
        assert.equal(result.rollbackFailed, undefined);
      }
      assert.equal(patchBodies.length, 2);
      const rollback = JSON.parse(patchBodies[1]!) as Record<string, unknown>;
      assert.equal(rollback.status, "waiting");
      assert.equal(rollback.resumed_at, null);
      assert.equal(rollback.resume_payload, null);
      assert.equal(rollback.resume_delivery_id, null);
    }
  );
});

test("resumeFlowWait surfaces rollbackFailed when both completeToken and the rollback throw", async () => {
  const { resumeFlowWait } = await loadWaitService();

  const candidate = {
    id: "wait-3",
    user_id: "user-1",
    job_run_id: "job-3",
    flow_id: "flow-1",
    installation_id: 99 as number | null,
    repo_id: "repo-1" as string | null,
    node_id: "await-1",
    wait_kind: "github_label_added" as const,
    wait_config: {
      kind: "github_label_added" as const,
      labelName: "broken",
      prOnly: true,
    },
    resume_token: "tok-broken",
  };

  let patchCount = 0;
  await withFetch(
    async ({ url, method }) => {
      if (url.includes("/rest/v1/flow_waits") && method === "PATCH") {
        patchCount += 1;
        if (patchCount === 1) {
          return Response.json({ resume_token: candidate.resume_token });
        }
        return Response.json(
          { code: "PGRST500", message: "rollback failed" },
          { status: 500 }
        );
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
    async () => {
      const result = await resumeFlowWait(
        {
          candidate,
          payload: { delivery_id: "d-broken" },
          deliveryId: "d-broken",
        },
        {
          completeWaitToken: async () => {
            throw new Error("trigger.dev unavailable");
          },
        }
      );

      assert.equal(result.resumed, false);
      if (!result.resumed) {
        assert.equal(result.reason, "complete_failed");
        assert.equal(result.rollbackFailed, true);
      }
      assert.equal(patchCount, 2);
    }
  );
});

test("resumeFlowWait applies the not-expired guard to the CAS when notExpiredAt is set", async () => {
  const { resumeFlowWait } = await loadWaitService();

  const candidate = {
    id: "wait-approval-1",
    user_id: "user-1",
    job_run_id: "job-1",
    flow_id: "flow-1",
    installation_id: 99 as number | null,
    repo_id: "repo-1" as string | null,
    node_id: "node-1",
    wait_kind: "tool_approval" as const,
    wait_config: {
      kind: "tool_approval" as const,
      toolName: "updateFile",
      toolCallId: "call-1",
      toolInput: "{}",
      nodeId: "node-1",
      nodeLabel: "Review",
      agentName: null,
      repoFullName: null,
    },
    resume_token: "tok-approval",
  };

  const patchUrls: string[] = [];
  const outcome = await withFetch(
    async ({ url, method }) => {
      if (url.includes("/rest/v1/flow_waits") && method === "PATCH") {
        patchUrls.push(url);
        return Response.json(null, { status: 200 });
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
    () =>
      resumeFlowWait(
        {
          candidate,
          payload: { decision: "approve" },
          deliveryId: null,
          notExpiredAt: "2026-07-22T12:00:00.000Z",
        },
        {
          completeWaitToken: async () => {
            throw new Error(
              "must not complete a token when the CAS matched no row"
            );
          },
        }
      )
  );

  assert.equal(patchUrls.length, 1);
  assert.ok(
    patchUrls[0].includes("expires_at=gt."),
    `CAS update must carry the expires_at guard, got: ${patchUrls[0]}`
  );
  assert.deepEqual(outcome, { resumed: false, reason: "already_resumed" });
});
