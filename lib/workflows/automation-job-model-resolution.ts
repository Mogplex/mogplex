import { resolveUserLanguageModel } from "@/lib/ai-model-resolver";
import type { GatewayCallContext } from "@/lib/models/gateway-provider-routing";
import { resolveRuntimeModelId } from "@/lib/models/supersession-runtime";
import {
  loadTeamAllowlistState,
  type TeamAllowlistState,
} from "@/lib/team-capabilities";
import { buildAutomationProviderFetch } from "@/lib/workflows/automation-model-execution";
import {
  AUTOMATION_GATEWAY_FALLBACK_MODELS_ENV,
  getAutomationModelFallbackIds,
} from "@/lib/workflows/automation-model-defaults";
import type { AutomationLanguageModel } from "@/lib/workflows/automation-job-types";

export async function resolveAutomationModel(
  userId: string,
  modelId: string,
  timeoutMs?: number | null,
  gatewayContext?: GatewayCallContext,
  teamId?: string | null
): Promise<AutomationLanguageModel> {
  // Published flow versions are immutable snapshots, so a graph published
  // before a model was retired still pins the retired id. Upgrade it to the
  // recorded successor here rather than rewriting version history; the
  // reconciler handles the mutable pins (draft graphs, agents.model). No-op
  // for any model that has not been superseded.
  //
  // The upgrade applies the same guards as the SQL reconciler — the owner's
  // auto_enable_new_models opt-out, an explicitly disabled successor, successor
  // availability, and the team allowlist — so published automations honour the
  // opt-out exactly as draft graphs do. The allowlist is read once and handed to
  // both steps, so passing it on to resolveUserLanguageModel avoids re-reading
  // it there.
  //
  // Both steps now consume the same closed union, so an unreadable allowlist
  // fails closed in both: the upgrade is withheld and the invocation is refused
  // (#764). Previously only the upgrade fought that case, and the null the gate
  // received was indistinguishable from "unrestricted".
  const allowlistState: TeamAllowlistState = teamId
    ? await loadTeamAllowlistState(teamId)
    : { status: "unrestricted" };
  const effectiveModelId = await resolveRuntimeModelId(
    userId,
    modelId,
    allowlistState
  );

  const resolved = await resolveUserLanguageModel(userId, effectiveModelId, {
    providerFetch: buildAutomationProviderFetch({ timeoutMs }),
    preferGatewayProviderObject: true,
    gatewayContext: gatewayContext ?? { userId },
    gatewayFallbackModelIds: getAutomationModelFallbackIds(
      effectiveModelId,
      process.env[AUTOMATION_GATEWAY_FALLBACK_MODELS_ENV]
    ),
    teamId: teamId ?? null,
    allowlistState,
  });

  return { ...resolved, effectiveModelId };
}
