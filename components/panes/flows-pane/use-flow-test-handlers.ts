import { useCallback, type RefObject } from "react";
import { toast } from "@/hooks/use-toast";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import type { Flow, FlowRunRecord } from "@/lib/types";
import type { AutomationSandboxTestResult } from "./types";

export type FlowTestHandlersDeps = {
  // Sandbox test state
  sandboxTestRepoId: string;
  setSandboxTestRunning: (running: boolean) => void;
  setSandboxTestResult: (result: AutomationSandboxTestResult | null) => void;
  setSandboxTestError: (error: string | null) => void;
  // Webhook state
  webhookSecretGeneratingRef: RefObject<boolean>;
  setWebhookSecretGenerating: (generating: boolean) => void;
  setGeneratedWebhookSecretState: (
    state: { flowId: string; secret: string } | null
  ) => void;
  // Trigger test state
  setTriggerTestRunning: (running: boolean) => void;
  // Props
  selectedFlow: Flow | undefined;
  activeTeamId: string | null;
  // Mutators
  mutateFlows: () => Promise<Flow[] | undefined>;
  mutateSelectedFlow: () => Promise<Flow | undefined>;
  mutateFlowRuns: () => Promise<{ runs: FlowRunRecord[] } | undefined>;
};

export type FlowTestHandlers = {
  runAutomationSandboxTest: () => Promise<void>;
  generateWebhookSecret: () => Promise<void>;
  copyWebhookValue: (value: string, label: string) => Promise<void>;
  runTriggerTest: (payload: Record<string, unknown>) => Promise<void>;
};

/**
 * Handlers for sandbox testing, webhook secret generation, and trigger tests.
 */
export function useFlowTestHandlers(
  deps: FlowTestHandlersDeps
): FlowTestHandlers {
  const {
    sandboxTestRepoId,
    setSandboxTestRunning,
    setSandboxTestResult,
    setSandboxTestError,
    webhookSecretGeneratingRef,
    setWebhookSecretGenerating,
    setGeneratedWebhookSecretState,
    setTriggerTestRunning,
    selectedFlow,
    activeTeamId,
    mutateFlows,
    mutateSelectedFlow,
    mutateFlowRuns,
  } = deps;

  const runAutomationSandboxTest = useCallback(async () => {
    if (!sandboxTestRepoId) return;
    setSandboxTestRunning(true);
    setSandboxTestResult(null);
    setSandboxTestError(null);

    try {
      const response = await fetch("/api/automations/sandbox-test", {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId
        ),
        body: JSON.stringify({ repoId: sandboxTestRepoId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | AutomationSandboxTestResult
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error || `Sandbox test failed (${response.status})`
        );
      }
      setSandboxTestResult(payload as AutomationSandboxTestResult);
    } catch (error) {
      setSandboxTestError(
        error instanceof Error ? error.message : "Sandbox test failed"
      );
    } finally {
      setSandboxTestRunning(false);
    }
  }, [
    activeTeamId,
    sandboxTestRepoId,
    setSandboxTestError,
    setSandboxTestResult,
    setSandboxTestRunning,
  ]);

  const generateWebhookSecret = useCallback(async () => {
    if (!selectedFlow || webhookSecretGeneratingRef.current) return;
    (webhookSecretGeneratingRef as React.MutableRefObject<boolean>).current =
      true;
    setWebhookSecretGenerating(true);
    try {
      const response = await fetch(
        `/api/flows/${selectedFlow.id}/webhook-secret`,
        {
          method: "POST",
        }
      );
      const payload = (await response.json().catch(() => null)) as {
        secret?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.secret) {
        throw new Error(payload?.error || "Failed to generate webhook secret");
      }
      setGeneratedWebhookSecretState({
        flowId: selectedFlow.id,
        secret: payload.secret,
      });
      await Promise.all([mutateSelectedFlow(), mutateFlows()]);
      toast({
        title: selectedFlow.webhook_configured
          ? "Webhook secret rotated"
          : "Webhook secret generated",
        description: "Copy it now. The signing secret is only shown once.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to generate webhook secret",
        variant: "destructive",
      });
    } finally {
      (webhookSecretGeneratingRef as React.MutableRefObject<boolean>).current =
        false;
      setWebhookSecretGenerating(false);
    }
  }, [
    mutateFlows,
    mutateSelectedFlow,
    selectedFlow,
    setGeneratedWebhookSecretState,
    setWebhookSecretGenerating,
    webhookSecretGeneratingRef,
  ]);

  const copyWebhookValue = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select and copy the value manually.",
        variant: "destructive",
      });
    }
  }, []);

  const runTriggerTest = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!selectedFlow) return;
      setTriggerTestRunning(true);
      try {
        const response = await fetch(
          `/api/flows/${selectedFlow.id}/test-trigger`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload }),
          }
        );
        const resultPayload = (await response.json().catch(() => null)) as {
          error?: string;
          jobRunId?: string | null;
          outcome?: string;
        } | null;
        if (!response.ok) {
          throw new Error(resultPayload?.error || "Failed to send test event");
        }
        await mutateFlowRuns();
        toast({
          title:
            resultPayload?.outcome === "queued"
              ? "Test event queued"
              : "Test event received",
          description: resultPayload?.jobRunId
            ? `Run ${resultPayload.jobRunId.slice(0, 8)} started from the published trigger.`
            : "The event was deduplicated or suppressed.",
        });
      } catch (error) {
        toast({
          title: "Test event failed",
          description:
            error instanceof Error
              ? error.message
              : "Failed to send test event",
          variant: "destructive",
        });
      } finally {
        setTriggerTestRunning(false);
      }
    },
    [mutateFlowRuns, selectedFlow, setTriggerTestRunning]
  );

  return {
    runAutomationSandboxTest,
    generateWebhookSecret,
    copyWebhookValue,
    runTriggerTest,
  };
}
