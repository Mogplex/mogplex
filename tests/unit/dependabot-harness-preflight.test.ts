import assert from "node:assert/strict";
import test from "node:test";
import {
  executeFlowAgentNode,
  type AgentNodeInput,
} from "../../lib/workflows/automation-job-agent-node";
import { createFlowRunState } from "../../lib/workflows/automation-job-flow-run-state";
import type { FlowGraph } from "../../lib/types";

async function preflight(action: string, alert: Record<string, unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ number: 17, ...alert });
  const node: AgentNodeInput["node"] = {
    id: "agent",
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      label: "Remediator",
      agentId: null,
      harness: "codex",
      role: "triage",
    },
  };
  const graph: FlowGraph = { nodes: [node], edges: [] };
  const unexpected = async () => {
    throw new Error("Must not execute a model, sandbox or GitHub mutation");
  };
  let report: string | null = null;
  const input: AgentNodeInput = {
    jobRunId: "job-1",
    githubToken: "test-token",
    triggerPrNumber: null,
    context: {
      assignmentType: "dependabot_alert",
      skillId: null,
      metadata: { webhook_action: action, alert_number: 17 },
      agent: { model: "unused", system_prompt: null },
      repo: {
        id: "repo-1",
        user_id: "user-1",
        full_name: "acme/widgets",
        default_branch: "main",
        github_installation_id: 123,
      },
    },
    node,
    resolvedFlow: {
      flowId: "flow-1",
      flowVersionId: "version-1",
      graph,
      agentsById: new Map(),
    },
    state: createFlowRunState({ graph, initialHeadSha: null }),
    executorDeps: {},
    execCtx: {
      node,
      label: "Remediator",
      inboundTokens: [],
      activeInboundTokens: [],
      shouldSkip: false,
      nodeRun: {
        id: "node-run",
        startedAt: "2026-09-12T00:00:00Z",
        observabilityError: null,
      },
      completeSkipped: async (reason) => {
        report = reason;
        return { ok: true, emitted: [] };
      },
      completeNodeRun: unexpected,
      completeFailedNode: unexpected,
      runOperator: unexpected,
      routeFailureOrNull: () => null,
      emitToOutgoing: () => [],
      collectPredecessorOutputs: () => [],
    },
    deps: {
      loadPullRequestDetails: unexpected,
      resolveAutofixTargetRepo: unexpected,
      resolveAutofixGithubToken: unexpected,
      resolveAutomationModel: unexpected,
      runAutomationHarnessAgent: unexpected,
      runPRFixAgent: unexpected,
      runPRFixAgentInSandbox: unexpected,
      tryLogAiCall: unexpected,
      executeAutomationContext: unexpected,
    },
  };
  try {
    await executeFlowAgentNode(input);
    return report;
  } finally {
    globalThis.fetch = original;
  }
}

test("external harnesses reconcile lifecycle state without starting a process or closing work", async () => {
  for (const action of [
    "fixed",
    "dismissed",
    "reopened",
    "reintroduced",
    "auto_dismissed",
  ]) {
    const report = await preflight(action, {
      state: action === "reopened" ? "open" : action,
      dismissed_comment: "Approved exception",
      dismissed_by: { login: "maintainer" },
    });
    assert.match(report!, /lifecycle reconciled/);
    assert.match(report!, /Approved exception/);
    assert.match(report!, /maintainer/);
  }
});

test("external harnesses skip closed or unpatched created alerts before paid execution", async () => {
  assert.match(
    (await preflight("created", { state: "fixed" }))!,
    /no longer open/
  );
  assert.match(
    (await preflight("created", {
      state: "open",
      security_vulnerability: { first_patched_version: null },
    }))!,
    /No patched version/
  );
});
