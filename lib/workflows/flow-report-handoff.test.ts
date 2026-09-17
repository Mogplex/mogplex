import { expect, it } from "vitest";
import {
  buildFlowReportHandoff,
  buildFlowReportContext,
  FLOW_REPORT_CONTEXT_CHARS,
  parseFlowDecision,
} from "./flow-report-handoff";
import { collectAncestorReports } from "./flow-report-context";
import { buildFlowConditionState } from "./automation-job-context-resolution";
import { buildPromptForJob } from "./automation-job-prompts";
import type { FlowGraph } from "@/lib/types";
import type { JobContext } from "./automation-job-types";

const marker =
  'MOGPLEX_FLOW_HANDOFF: {"decision":"NO_ACTION","summary":"Already covered by an open PR."}';
it("keeps a trailing structured decision separate from the bounded summary", () => {
  const text = `${"evidence ".repeat(150_000)}\n${marker}`;
  const handoff = buildFlowReportHandoff(
    "11111111-1111-4111-8111-111111111111",
    text
  );
  expect(handoff.decision).toEqual({ status: "reported", value: "NO_ACTION" });
  expect(handoff.summary).toBe("Already covered by an open PR.");
  expect(handoff.reportChars).toBe(text.length);
  expect(JSON.stringify(handoff).length).toBeLessThan(3000);
});

it("never infers approval from prose, missing, malformed or conflicting declarations", () => {
  expect(parseFlowDecision("DECISION: PROCEED").decision).toEqual({
    status: "missing",
    value: null,
  });
  for (const text of [
    "MOGPLEX_FLOW_HANDOFF: not-json",
    `${marker}\n${marker}`,
    'MOGPLEX_FLOW_HANDOFF: {"decision":"","summary":"ok"}',
    'MOGPLEX_FLOW_HANDOFF: {"decision":"PROCEED","summary":5}',
  ]) {
    expect(parseFlowDecision(text).decision).toEqual({
      status: "invalid",
      value: null,
    });
  }
});

it("bounds the entire upstream context and explicitly points to omitted reports", () => {
  const reports = Array.from({ length: 100 }, (_, i) => ({
    nodeId: `node-${i}`,
    label: "Report",
    ...buildFlowReportHandoff(
      `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      `${"x".repeat(10_000)}\n${marker}`
    ),
  }));
  const prompt = buildFlowReportContext({
    flow_reports: reports,
    flow_node_id: "next",
  });
  expect(prompt.length).toBeLessThanOrEqual(FLOW_REPORT_CONTEXT_CHARS);
  expect(prompt).toContain("NO_ACTION");
  expect(prompt).toContain("listFlowReports");
  expect(prompt).toContain("omitted");
  expect(prompt).not.toContain("x".repeat(1000));
  expect(
    buildPromptForJob(
      "unknown",
      { flow_reports: reports, flow_node_id: "next" },
      null
    ).prompt.length
  ).toBeLessThan(18_000);
});

it("carries ancestor decisions through joins without including unrelated branches", () => {
  const handoff = buildFlowReportHandoff(
    "11111111-1111-4111-8111-111111111111",
    marker
  );
  const outputs = new Map([
    ["analyst", { label: "Analysis", text: JSON.stringify(handoff), handoff }],
    [
      "unrelated",
      { label: "Unrelated", text: JSON.stringify(handoff), handoff },
    ],
  ]);
  const graph: FlowGraph = {
    nodes: [],
    edges: [
      { id: "a", source: "analyst", target: "join" },
      { id: "b", source: "join", target: "apply" },
    ],
  };
  expect(
    collectAncestorReports(graph, "apply", outputs).map(
      (report) => report.nodeId
    )
  ).toEqual(["analyst"]);
  const context = {
    metadata: {},
    repo: { id: "repo", full_name: "acme/widgets" },
  } as JobContext;
  expect(
    buildFlowConditionState({
      context,
      inboundTokens: [],
      outputs,
      flowState: new Map(),
    }).decisions.analyst
  ).toEqual({ status: "reported", value: "NO_ACTION" });
});
