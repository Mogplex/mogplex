import {
  deepClone,
  type FlowsE2ETestState,
  type TestFaultState,
} from "./test-store-types";

declare global {
  var __MOGPLEX_FLOWS_E2E_STATE: FlowsE2ETestState | undefined;
}

function defaultState(): FlowsE2ETestState {
  return {
    installations: [],
    agents: [],
    flows: [],
    flowVersions: [],
    flowTemplates: [],
    triggers: [],
    jobRuns: [],
    flowNodeRuns: [],
    dispatchEvents: [],
    aiCalls: [],
    aiCallEvents: [],
    assistant: {
      nextResult: null,
      nextError: null,
    },
    faults: {
      failNextFlowDelete: null,
    },
  };
}

export function isFlowsE2ETestMode() {
  return process.env.PLAYWRIGHT === "1";
}

export function getState() {
  if (!globalThis.__MOGPLEX_FLOWS_E2E_STATE) {
    globalThis.__MOGPLEX_FLOWS_E2E_STATE = defaultState();
  }

  return globalThis.__MOGPLEX_FLOWS_E2E_STATE;
}

export function resetFlowsE2ETestState(seed?: Partial<FlowsE2ETestState>) {
  const next = defaultState();

  if (seed) {
    next.installations = deepClone(seed.installations || []);
    next.agents = deepClone(seed.agents || []);
    next.flows = deepClone(seed.flows || []);
    next.flowVersions = deepClone(seed.flowVersions || []);
    next.flowTemplates = deepClone(seed.flowTemplates || []);
    next.triggers = deepClone(seed.triggers || []);
    next.jobRuns = deepClone(seed.jobRuns || []);
    next.flowNodeRuns = deepClone(seed.flowNodeRuns || []);
    next.dispatchEvents = deepClone(seed.dispatchEvents || []);
    next.aiCalls = deepClone(seed.aiCalls || []);
    next.aiCallEvents = deepClone(seed.aiCallEvents || []);
    next.assistant = {
      nextResult: seed.assistant?.nextResult
        ? deepClone(seed.assistant.nextResult)
        : null,
      nextError: seed.assistant?.nextError ?? null,
    };
    next.faults = {
      failNextFlowDelete: seed.faults?.failNextFlowDelete ?? null,
    };
  }

  globalThis.__MOGPLEX_FLOWS_E2E_STATE = next;
  return snapshotFlowsE2ETestState();
}

export function snapshotFlowsE2ETestState() {
  return deepClone(getState());
}

export function consumeFault(name: keyof TestFaultState) {
  const state = getState();
  const message = state.faults[name];
  state.faults[name] = null;
  return message;
}
