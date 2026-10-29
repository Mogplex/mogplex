import { loadOwnedFlow } from "@/lib/flows/server-flow-ops";
import { runWithFlowActivationLock } from "@/lib/flows/activation-lock";
import { coerceGraph, getStartConfig } from "@/lib/flows/graph";
import { validateFlowConfiguration } from "@/lib/flows/server-validation";
import { saveFlowVersion } from "@/lib/flows/server-version";
import { resolveFlowGraphPresetAgents } from "@/lib/flows/server-preset-agents";
import {
  createTriggerMogplexApiAutomation,
  loadAutomationTriggerRepo,
  type AutomationTriggerDeps,
} from "./automation-trigger";
import {
  MogplexApiAutomationError,
  type TriggerMogplexApiAutomationInput,
} from "./automations.types";

/** A real execution of a saved draft, without changing the published version or trigger. */
export function createTestMogplexApiAutomation(
  overrides: Partial<AutomationTriggerDeps> = {}
) {
  return async (input: TriggerMogplexApiAutomationInput) => {
    // Defense for direct service callers; HTTP also checks both target teams.
    if (input.credential?.automationOnly)
      throw new MogplexApiAutomationError(
        "AUTOMATION_NOT_INTEGRATION_ENABLED",
        "Testing drafts requires Full access.",
        403
      );
    const owned = await loadOwnedFlow(input.userId, input.automationId);
    if (!owned)
      throw new MogplexApiAutomationError(
        "AUTOMATION_NOT_FOUND",
        "Automation not found",
        404
      );
    return runWithFlowActivationLock(owned.id, async () => {
      const flow = await loadOwnedFlow(input.userId, owned.id);
      if (!flow)
        throw new MogplexApiAutomationError(
          "AUTOMATION_NOT_FOUND",
          "Automation not found",
          404
        );
      const draft = coerceGraph(flow.draft_graph);
      const repo = await (overrides.loadRepo ?? loadAutomationTriggerRepo)(
        input.userId,
        input.repoId
      );
      if (!repo?.github_installation_id)
        throw new MogplexApiAutomationError(
          "REPO_NOT_FOUND",
          "Repository not found",
          404
        );
      const installationId = repo.github_installation_id;
      const scopedIds = getStartConfig(draft)?.filter?.installationIds;
      // An explicit draft scope may change the installation on publication.
      // Otherwise testing must retain the automation's existing installation.
      if (
        scopedIds?.length
          ? !scopedIds.includes(installationId)
          : installationId !== flow.installation_id
      )
        throw new MogplexApiAutomationError(
          "REPO_SCOPE_MISMATCH",
          "Repository is outside the draft's installation scope."
        );
      const graph = await resolveFlowGraphPresetAgents(
        input.userId,
        draft,
        undefined,
        repo.product_team_id
      );
      const validation = await validateFlowConfiguration(
        input.userId,
        graph,
        installationId,
        repo.product_team_id
      );
      if (!validation.valid)
        throw new MogplexApiAutomationError(
          "INVALID_INPUT",
          validation.errors.join(" ")
        );
      const version = await saveFlowVersion(flow.id, graph, true);
      const trigger = createTriggerMogplexApiAutomation(
        {
          ...overrides,
          loadFlow: async () => ({
            ...flow,
            installation_id: installationId,
            status: "active",
            published_version_id: version.id,
            published_version: { ...version, graph },
          }),
        },
        "test"
      );
      const result = await trigger(input);
      return {
        ...result,
        test: true,
        message:
          "Draft test submitted. This is a real billed execution with configured actions. Inspect run logs for completion and node errors before publishing.",
      };
    });
  };
}

export const testMogplexApiAutomation = createTestMogplexApiAutomation();
