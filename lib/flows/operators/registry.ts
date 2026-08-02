import type { FlowNode, FlowNodeType } from "@/lib/types";
import { agentOperator } from "./agent";
import { actionOperator } from "./action";
import { awaitEventOperator } from "./await-event";
import { conditionOperator } from "./condition";
import { delayOperator } from "./delay";
import { endOperator } from "./end";
import { joinOperator } from "./join";
import { parallelOperator } from "./parallel";
import { setVariableOperator } from "./state";
import { startOperator } from "./start";
import { transformOperator } from "./transform";
import type { FlowOperatorDefinition, FlowOperatorRegistry } from "./types";

export const FLOW_OPERATOR_REGISTRY: FlowOperatorRegistry = {
  start: startOperator,
  agent: agentOperator,
  action: actionOperator,
  condition: conditionOperator,
  parallel: parallelOperator,
  join: joinOperator,
  delay: delayOperator,
  await_event: awaitEventOperator,
  set_variable: setVariableOperator,
  transform: transformOperator,
  end: endOperator,
};

export function getFlowOperator<T extends FlowNodeType>(
  type: T
): FlowOperatorDefinition<Extract<FlowNode, { type: T }>> {
  return FLOW_OPERATOR_REGISTRY[type] as FlowOperatorDefinition<
    Extract<FlowNode, { type: T }>
  >;
}

export type { FlowOperatorDefinition, FlowOperatorRegistry } from "./types";
