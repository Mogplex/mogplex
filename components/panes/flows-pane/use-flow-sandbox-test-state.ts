import { useRef, useState } from "react";
import type { AutomationSandboxTestResult } from "./types";

export type FlowSandboxTestState = {
  // Sandbox test
  sandboxTestRepoId: string;
  setSandboxTestRepoId: (id: string) => void;
  sandboxTestNodeId: string | null;
  setSandboxTestNodeId: (id: string | null) => void;
  sandboxTestResult: AutomationSandboxTestResult | null;
  setSandboxTestResult: (result: AutomationSandboxTestResult | null) => void;
  sandboxTestError: string | null;
  setSandboxTestError: (error: string | null) => void;
  sandboxTestRunning: boolean;
  setSandboxTestRunning: (running: boolean) => void;
  // Trigger test
  triggerTestRunning: boolean;
  setTriggerTestRunning: (running: boolean) => void;
  // Webhook secret
  webhookSecretGeneratingRef: React.MutableRefObject<boolean>;
  webhookSecretGenerating: boolean;
  setWebhookSecretGenerating: (generating: boolean) => void;
  generatedWebhookSecretState: { flowId: string; secret: string } | null;
  setGeneratedWebhookSecretState: (
    state: { flowId: string; secret: string } | null
  ) => void;
};

export type FlowSandboxTestStateParams = {
  selectedFlowId: string | null;
};

export type FlowSandboxTestStateDerived = {
  generatedWebhookSecret: string | null;
};

/**
 * Manages state for sandbox testing, trigger testing, and webhook secret generation.
 */
export function useFlowSandboxTestState({
  selectedFlowId,
}: FlowSandboxTestStateParams): FlowSandboxTestState &
  FlowSandboxTestStateDerived {
  const [sandboxTestRepoId, setSandboxTestRepoId] = useState("");
  const [sandboxTestNodeId, setSandboxTestNodeId] = useState<string | null>(
    null
  );
  const [sandboxTestResult, setSandboxTestResult] =
    useState<AutomationSandboxTestResult | null>(null);
  const [sandboxTestError, setSandboxTestError] = useState<string | null>(null);
  const [sandboxTestRunning, setSandboxTestRunning] = useState(false);
  const [triggerTestRunning, setTriggerTestRunning] = useState(false);
  const webhookSecretGeneratingRef = useRef(false);
  const [webhookSecretGenerating, setWebhookSecretGenerating] = useState(false);
  const [generatedWebhookSecretState, setGeneratedWebhookSecretState] =
    useState<{
      flowId: string;
      secret: string;
    } | null>(null);

  // Only return the secret if it matches the currently selected flow
  // Cast to align types for comparison (flowId is string | undefined, selectedFlowId is string | null)
  const generatedWebhookSecret =
    selectedFlowId !== null &&
    generatedWebhookSecretState?.flowId === selectedFlowId
      ? generatedWebhookSecretState.secret
      : null;

  return {
    sandboxTestRepoId,
    setSandboxTestRepoId,
    sandboxTestNodeId,
    setSandboxTestNodeId,
    sandboxTestResult,
    setSandboxTestResult,
    sandboxTestError,
    setSandboxTestError,
    sandboxTestRunning,
    setSandboxTestRunning,
    triggerTestRunning,
    setTriggerTestRunning,
    webhookSecretGeneratingRef,
    webhookSecretGenerating,
    setWebhookSecretGenerating,
    generatedWebhookSecretState,
    setGeneratedWebhookSecretState,
    generatedWebhookSecret,
  };
}
