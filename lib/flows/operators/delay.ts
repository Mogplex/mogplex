import type { FlowDelayNodeData, FlowNode } from "@/lib/types";
import { FAILURE_HANDLE_ID, getDelayNodeMs } from "@/lib/flows/graph-helpers";
import type { FlowOperatorDefinition } from "./types";

type DelayNode = Extract<FlowNode, { type: "delay" }>;

const DELAY_UNITS = ["seconds", "minutes", "hours"] as const;

function isDelayUnit(value: unknown): value is FlowDelayNodeData["unit"] {
  return DELAY_UNITS.includes(value as FlowDelayNodeData["unit"]);
}

export const delayOperator: FlowOperatorDefinition<DelayNode> = {
  type: "delay",
  canFail: true,
  validate: ({ node, inbound, outbound }) => {
    const errors: string[] = [];
    if (inbound.length !== 1)
      errors.push(
        `Wait node "${node.data.label}" must have exactly one incoming edge.`
      );
    // Error edges are optional and validated separately; the success path
    // must still have exactly one outgoing edge.
    const successEdges = outbound.filter(
      (edge) => edge.sourceHandle !== FAILURE_HANDLE_ID
    );
    if (successEdges.length !== 1)
      errors.push(
        `Wait node "${node.data.label}" must have exactly one outgoing edge.`
      );
    if (getDelayNodeMs(node.data) <= 0) {
      errors.push(
        `Wait node "${node.data.label}" must have a duration greater than zero.`
      );
    }
    return errors;
  },
  coerceData: (raw) => {
    const duration =
      typeof raw.duration === "number" && Number.isFinite(raw.duration)
        ? raw.duration
        : Number(raw.duration ?? 1);
    const unit = isDelayUnit(raw.unit) ? raw.unit : "seconds";
    return {
      label: typeof raw.label === "string" ? raw.label : "Wait",
      duration: Number.isFinite(duration) ? duration : 1,
      unit,
    };
  },
  defaultData: (input) => ({
    label: input.label?.trim() || `Wait ${input.nextIndex}`,
    duration: 5,
    unit: "minutes",
  }),
  execute: async ({
    node,
    label,
    shouldSkip,
    outputs,
    completeNodeRun,
    completeSkipped,
    emit,
    waitProvider,
  }) => {
    if (shouldSkip) {
      return completeSkipped(
        "Wait skipped because every incoming branch was skipped"
      );
    }
    const delayMs = getDelayNodeMs(node.data);
    if (delayMs > 0) {
      await waitProvider.sleep({ untilDate: new Date(Date.now() + delayMs) });
    }
    const summary = `${label} waited ${delayMs}ms`;
    outputs.set(node.id, { label, text: summary });
    await completeNodeRun({
      status: "success",
      output: {
        delay_ms: delayMs,
        duration: node.data.duration,
        unit: node.data.unit,
      },
    });
    return { ok: true, emitted: emit(label, summary) };
  },
};
