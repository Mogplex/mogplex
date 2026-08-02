import type { FlowJoinPolicy, FlowNode } from "@/lib/types";
import type { FlowOperatorDefinition, FlowOperatorEmittedToken } from "./types";

type JoinNode = Extract<FlowNode, { type: "join" }>;

const VALID_POLICIES: ReadonlyArray<FlowJoinPolicy> = [
  "wait_for_all",
  "wait_for_any",
  "quorum",
];

function coercePolicy(raw: unknown): FlowJoinPolicy {
  return typeof raw === "string" &&
    (VALID_POLICIES as ReadonlyArray<string>).includes(raw)
    ? (raw as FlowJoinPolicy)
    : "wait_for_all";
}

function coerceQuorum(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  return n > 0 ? n : null;
}

function activeCount(tokens: ReadonlyArray<FlowOperatorEmittedToken>): number {
  let n = 0;
  for (const token of tokens) if (!token.skipped) n += 1;
  return n;
}

export const joinOperator: FlowOperatorDefinition<JoinNode> = {
  type: "join",
  validate: ({ node, inbound, outbound }) => {
    const errors: string[] = [];
    if (inbound.length < 2)
      errors.push(
        `Join node "${node.data.label}" must have at least two incoming edges.`
      );
    if (outbound.length !== 1)
      errors.push(
        `Join node "${node.data.label}" must have exactly one outgoing edge.`
      );
    if (node.data.policy === "quorum") {
      const q = node.data.quorum;
      if (typeof q !== "number" || !Number.isInteger(q) || q < 2) {
        errors.push(
          `Join node "${node.data.label}" with quorum policy must set an integer quorum of at least 2.`
        );
      } else if (inbound.length >= 2 && q > inbound.length) {
        errors.push(
          `Join node "${node.data.label}" quorum (${q}) cannot exceed its ${inbound.length} incoming edges.`
        );
      }
    }
    return errors;
  },
  coerceData: (raw) => {
    const policy = coercePolicy(raw.policy);
    const quorum = policy === "quorum" ? coerceQuorum(raw.quorum) : null;
    return {
      label: typeof raw.label === "string" ? raw.label : "Merge",
      policy,
      quorum,
    };
  },
  defaultData: (input) => ({
    label: input.label?.trim() || `Join ${input.nextIndex}`,
    policy: "wait_for_all",
    quorum: null,
  }),
  isReady: ({ node, incomingCount, receivedTokens }) => {
    const policy = node.data.policy ?? "wait_for_all";
    if (policy === "wait_for_all") {
      return receivedTokens.length === incomingCount;
    }
    if (policy === "wait_for_any") {
      if (activeCount(receivedTokens) >= 1) return true;
      // Fall through once every inbound has reported (all-skipped case).
      return receivedTokens.length === incomingCount;
    }
    // quorum
    const quorum =
      typeof node.data.quorum === "number" && node.data.quorum > 0
        ? node.data.quorum
        : incomingCount;
    const active = activeCount(receivedTokens);
    if (active >= quorum) return true;
    const remaining = incomingCount - receivedTokens.length;
    if (active + remaining < quorum) return true; // unreachable -> fire to skip
    return false;
  },
  execute: async ({
    node,
    label,
    graph,
    inboundTokens,
    activeInboundTokens,
    outputs,
    completeNodeRun,
    emit,
  }) => {
    const policy: FlowJoinPolicy = node.data.policy ?? "wait_for_all";
    const inboundEdges = graph.edges.filter((edge) => edge.target === node.id);
    const incomingCount = inboundEdges.length;
    const arrivedSources = new Set(
      inboundTokens.map((token) => token.fromNodeId)
    );
    const pendingFrom = inboundEdges
      .filter((edge) => !arrivedSources.has(edge.source))
      .map((edge) => {
        const sourceNode = graph.nodes.find((n) => n.id === edge.source);
        return typeof sourceNode?.data.label === "string"
          ? sourceNode.data.label
          : edge.source;
      });
    const activeFrom = activeInboundTokens.map((token) => token.label);
    const skippedFrom = inboundTokens
      .filter((token) => token.skipped)
      .map((token) => token.label);

    if (policy === "wait_for_all") {
      if (activeInboundTokens.length === 0) {
        await completeNodeRun({
          status: "skipped",
          output: {
            policy,
            active_from: [],
            skipped_from: skippedFrom,
            pending_from: pendingFrom,
            emitted_after: inboundTokens.length,
            reason: "all_skipped",
          },
        });
        return {
          ok: true,
          emitted: emit(label, "Join skipped: every branch was skipped", {
            skipped: true,
          }),
        };
      }
      const summary = `${label} merged ${activeInboundTokens.length} branch(es)`;
      outputs.set(node.id, { label, text: summary });
      await completeNodeRun({
        status: "success",
        output: {
          policy,
          active_from: activeFrom,
          skipped_from: skippedFrom,
          pending_from: pendingFrom,
          emitted_after: inboundTokens.length,
          reason: "policy_satisfied",
        },
      });
      return { ok: true, emitted: emit(label, summary) };
    }

    if (policy === "wait_for_any") {
      if (activeInboundTokens.length === 0) {
        await completeNodeRun({
          status: "skipped",
          output: {
            policy,
            active_from: [],
            skipped_from: skippedFrom,
            pending_from: pendingFrom,
            emitted_after: inboundTokens.length,
            reason: "all_skipped",
          },
        });
        return {
          ok: true,
          emitted: emit(label, "Join skipped: every branch was skipped", {
            skipped: true,
          }),
        };
      }
      const summary = `${label} resumed on first active branch (${activeInboundTokens[0].label})`;
      outputs.set(node.id, { label, text: summary });
      await completeNodeRun({
        status: "success",
        output: {
          policy,
          active_from: activeFrom,
          skipped_from: skippedFrom,
          pending_from: pendingFrom,
          // emitted_after is the count of tokens received at decision time.
          // Slower branches whose tokens arrive after the join fires are
          // tracked by the executor but ignored by this node.
          emitted_after: inboundTokens.length,
          reason: "policy_satisfied",
        },
      });
      return { ok: true, emitted: emit(label, summary) };
    }

    // quorum
    const quorum =
      typeof node.data.quorum === "number" && node.data.quorum > 0
        ? node.data.quorum
        : Math.max(2, incomingCount);
    if (activeInboundTokens.length >= quorum) {
      const summary = `${label} reached quorum (${activeInboundTokens.length}/${quorum})`;
      outputs.set(node.id, { label, text: summary });
      await completeNodeRun({
        status: "success",
        output: {
          policy,
          quorum,
          active_from: activeFrom,
          skipped_from: skippedFrom,
          pending_from: pendingFrom,
          emitted_after: inboundTokens.length,
          reason: "policy_satisfied",
        },
      });
      return { ok: true, emitted: emit(label, summary) };
    }

    // Unreachable: active + still-pending can't make quorum, or every branch
    // arrived skipped. Emit skipped downstream.
    const reason: "quorum_unreachable" | "all_skipped" =
      activeInboundTokens.length === 0 && inboundTokens.length === incomingCount
        ? "all_skipped"
        : "quorum_unreachable";
    await completeNodeRun({
      status: "skipped",
      output: {
        policy,
        quorum,
        active_from: activeFrom,
        skipped_from: skippedFrom,
        pending_from: [],
        emitted_after: incomingCount,
        reason,
      },
    });
    return {
      ok: true,
      emitted: emit(
        label,
        reason === "all_skipped"
          ? "Join skipped: every branch was skipped"
          : `Join skipped: quorum (${quorum}) cannot be met`,
        { skipped: true }
      ),
    };
  },
};
