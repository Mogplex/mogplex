import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGateway } from "ai";
import {
  loadUserPlatformAccess,
  PLATFORM_AI_ACCESS_ERROR,
  PLATFORM_ANTHROPIC_ACCESS_ERROR,
  PLATFORM_OPENAI_ACCESS_ERROR,
  PLATFORM_OPENROUTER_ACCESS_ERROR,
} from "@/lib/platform-access";
import {
  gatewayProviderOptions,
  type GatewayCallContext,
  type GatewayProviderOptions,
} from "@/lib/models/gateway-provider-routing";
import { applyOpenRouterNitro } from "@/lib/models/openrouter-variants";
import { deferTeamAuditEvent, recordTeamAuditEvent } from "@/lib/team-audit";
import { getScopedProviderKey } from "@/lib/vault";
import {
  ALL_CAPABILITIES,
  ALLOWLIST_FAILURE_LOG_TTL_MS,
  allowlistPermitsModel,
  CAPABILITY_MODEL_DENIED_ERROR,
  hasCapability,
  loadTeamAllowlistState as defaultLoadTeamAllowlistState,
  modelCapability,
  modelAllowlistUnavailableError,
  MODEL_NOT_IN_ALLOWLIST_ERROR,
  resolveMemberCapabilities as defaultResolveMemberCapabilities,
  claimAllowlistSignalSlot,
  type Capability,
  type TeamAllowlistState,
} from "@/lib/team-capabilities";
import type { generateText } from "ai";
import type { Provider } from "@/lib/vault";

export type ResolvedLanguageModel = Parameters<typeof generateText>[0]["model"];
export type ResolveUserLanguageModelOptions = {
  providerFetch?: typeof fetch;
  preferGatewayProviderObject?: boolean;
  gatewayContext?: GatewayCallContext;
  /**
   * Ordered model fallbacks for AI Gateway calls. Candidates are filtered
   * through the same team capability and allowlist policy as the primary.
   */
  gatewayFallbackModelIds?: readonly string[];
  /** Team scope, if the caller is acting inside a team. Null/undefined = solo. */
  teamId?: string | null;
  /**
   * Pre-resolved capability set for the active scope. When omitted and
   * `teamId` is set, the resolver looks it up via the injected dep.
   */
  capabilities?: ReadonlySet<Capability>;
  /**
   * Pre-resolved team allowlist state. When omitted and `teamId` is set, the
   * resolver loads it via the injected dep.
   *
   * A closed union rather than the array-or-null it replaced: a caller that had
   * already read the allowlist could only forward a failed read as null, which
   * this gate then read as unrestricted (#764).
   */
  allowlistState?: TeamAllowlistState;
};

// Tagged result so call sites can attach `providerOptions` only when the
// resolved transport is the AI Gateway. Direct providers (OpenAI, Anthropic,
// OpenRouter) get `providerOptions: undefined` — the AI SDK would silently
// ignore gateway-namespaced options on those paths, but that masks logs and
// muddies intent, so we omit them entirely.
export type ResolvedUserLanguageModel = {
  model: ResolvedLanguageModel;
  providerOptions?: GatewayProviderOptions;
};

function filterGatewayFallbackModelIds(input: {
  candidates: readonly string[];
  capabilities: ReadonlySet<Capability>;
  teamId: string | null;
  allowlistState: TeamAllowlistState;
}) {
  return input.candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .filter((candidate) =>
      hasCapability(input.capabilities, modelCapability(candidate))
    )
    .filter(
      (candidate) =>
        !input.teamId || allowlistPermitsModel(input.allowlistState, candidate)
    );
}

type ResolveUserLanguageModelDeps = {
  /**
   * Scope-aware key lookup. When `teamId` is set, prefer `team_provider_keys`
   * and fall back to the user's personal key.
   */
  getProviderKey: (
    userId: string,
    provider: Provider,
    teamId?: string | null
  ) => Promise<string | null>;
  loadUserPlatformAccess: (
    userId: string
  ) => Promise<{ allowPlatformAi: boolean }>;
  resolveMemberCapabilities: (
    userId: string,
    teamId: string | null | undefined
  ) => Promise<ReadonlySet<Capability>>;
  loadTeamAllowlistState: (teamId: string) => Promise<TeamAllowlistState>;
  recordTeamAuditEvent: typeof recordTeamAuditEvent;
  resolveGatewayModel: (
    apiKey: string,
    modelId: string,
    options?: { fetch?: typeof fetch }
  ) => ResolvedLanguageModel;
  resolveOpenAIModel: (
    apiKey: string,
    modelId: string,
    options?: { fetch?: typeof fetch }
  ) => ResolvedLanguageModel;
  resolveAnthropicModel: (
    apiKey: string,
    modelId: string,
    options?: { fetch?: typeof fetch }
  ) => ResolvedLanguageModel;
  resolveOpenRouterModel: (
    apiKey: string,
    modelId: string,
    options?: { fetch?: typeof fetch }
  ) => ResolvedLanguageModel;
};

export function getOpenRouterAppUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return appUrl || undefined;
}

const defaultResolveUserLanguageModelDeps: ResolveUserLanguageModelDeps = {
  getProviderKey: getScopedProviderKey,
  loadUserPlatformAccess,
  resolveMemberCapabilities: defaultResolveMemberCapabilities,
  loadTeamAllowlistState: defaultLoadTeamAllowlistState,
  recordTeamAuditEvent,
  resolveGatewayModel(apiKey, modelId, options) {
    return createGateway({ apiKey, fetch: options?.fetch })(modelId);
  },
  resolveOpenAIModel(apiKey, modelId, options) {
    return createOpenAI({ apiKey, fetch: options?.fetch })(modelId);
  },
  resolveAnthropicModel(apiKey, modelId, options) {
    return createAnthropic({ apiKey, fetch: options?.fetch })(
      modelId.replace(/\./g, "-")
    );
  },
  resolveOpenRouterModel(apiKey, modelId, options) {
    const appUrl = getOpenRouterAppUrl();
    return createOpenRouter({
      apiKey,
      compatibility: "strict",
      appName: "Mogplex",
      ...(appUrl ? { appUrl } : {}),
      fetch: options?.fetch,
    })(modelId);
  },
};

export function createResolveUserLanguageModel(
  overrides: Partial<ResolveUserLanguageModelDeps> = {}
) {
  const deps: ResolveUserLanguageModelDeps = {
    ...defaultResolveUserLanguageModelDeps,
    ...overrides,
  };

  return async function resolveUserLanguageModel(
    userId: string,
    modelId: string,
    options?: ResolveUserLanguageModelOptions
  ): Promise<ResolvedUserLanguageModel> {
    const normalizedModel = modelId.trim();
    const [provider, ...modelParts] = normalizedModel.split("/");
    const providerModelId = modelParts.join("/");
    const isOpenRouterModel = provider === "openrouter" && providerModelId;
    const teamId = options?.teamId ?? null;

    // Capability + allowlist gates (no-ops for solo scope). Resolved lazily
    // when team scope is active and the caller didn't pre-supply them, so a
    // BYOK gateway request doesn't add a Supabase round-trip for solo users.
    const capabilities: ReadonlySet<Capability> = teamId
      ? (options?.capabilities ??
        (await deps.resolveMemberCapabilities(userId, teamId)))
      : ALL_CAPABILITIES;
    const requiredCap = modelCapability(normalizedModel);
    if (!hasCapability(capabilities, requiredCap)) {
      if (teamId) {
        deferTeamAuditEvent(deps.recordTeamAuditEvent, {
          productTeamId: teamId,
          actorUserId: userId,
          action: "model.denied",
          decisionCode: "capability_denied",
          targetType: "model",
          targetId: normalizedModel,
          payload: { required_capability: requiredCap },
        });
      }
      throw new Error(CAPABILITY_MODEL_DENIED_ERROR);
    }
    let allowlistState: TeamAllowlistState = { status: "unrestricted" };
    if (teamId) {
      allowlistState =
        options?.allowlistState ?? (await deps.loadTeamAllowlistState(teamId));
      // An unreadable allowlist is not an absent one. Treating it as
      // unrestricted let a transient `teams` read error bypass the team's model
      // policy for that call, so a governance control had a fail-open path
      // (#764). Denying is the same choice resolveMemberCapabilities already
      // makes for a non-member: when the policy cannot be established, the call
      // does not proceed.
      if (allowlistState.status === "unknown") {
        // Throttled together, on one window. Both the audit row and the log
        // fire per denied call, and during a sustained outage that means
        // hammering the same Supabase instance whose read just failed with a
        // write that is least likely to succeed right then.
        //
        // Throttling an audit write is a real semantic change for a
        // compliance-shaped table, so the reason it is not just a load
        // optimisation: deferTeamAuditEvent is fire-and-forget with a catch, so
        // during a Supabase outage the per-call writes this replaces would
        // largely *fail* anyway — each one adding a "[team-audit] unexpected
        // deferred audit failure" line to the same flood. The completeness the
        // throttle appears to cost was mostly never going to be recorded; what
        // it definitely costs is the ability to answer "was this user denied",
        // which the `throttled` marker on the row makes visible to a reader.
        // Reversible: drop the guard around this block to go back to per-call
        // rows.
        //
        // The `model_not_in_allowlist` branch below is deliberately NOT
        // throttled — that one *is* a policy decision about a specific call.
        const signalSlot = claimAllowlistSignalSlot(
          "resolver",
          teamId,
          allowlistState.reason
        );
        if (signalSlot.emit) {
          deferTeamAuditEvent(deps.recordTeamAuditEvent, {
            productTeamId: teamId,
            actorUserId: userId,
            action: "model.denied",
            decisionCode: "allowlist_unavailable",
            targetType: "model",
            targetId: normalizedModel,
            // Marks the row as an incident sample rather than an individual
            // event. Only one row is written per (team, cause) per window, so
            // its actorUserId/targetId belong to whichever call won the slot —
            // without this an admin would read it as "one user was denied" and
            // could not tell that others were. team_audit_events is
            // compliance-shaped, so the semantics of this one decision code
            // being a sample has to be visible in the row itself.
            //
            // Window derived, never restated: a hardcoded number here would
            // make a compliance row lie the moment the TTL is tuned.
            payload: {
              throttled: true,
              throttle_window_ms: ALLOWLIST_FAILURE_LOG_TTL_MS,
              // How many denials the previous window swallowed, so the row
              // states the size of the incident it stands for rather than
              // leaving it unrecoverable.
              //
              // Named `_in_process` because the throttle map is per-instance:
              // on horizontally-scaled serverless this under-reports by roughly
              // the instance fan-out, and a bare `suppressed_since_last` would
              // read as an absolute count to anyone querying
              // team_audit_events. The field name is the only place that
              // caveat can travel with the data.
              suppressed_since_last_in_process: signalSlot.suppressedSinceLast,
            },
          });
          // Cause goes to the log, not the audit payload: team audit rows are
          // an admin-facing surface and raw Postgres text does not belong on
          // one.
          console.error("Denying model invocation, allowlist unreadable", {
            teamId,
            userId,
            modelId: normalizedModel,
            reason: allowlistState.reason,
            suppressedSinceLast: signalSlot.suppressedSinceLast,
          });
        }
        throw modelAllowlistUnavailableError();
      }
      if (!allowlistPermitsModel(allowlistState, normalizedModel)) {
        deferTeamAuditEvent(deps.recordTeamAuditEvent, {
          productTeamId: teamId,
          actorUserId: userId,
          action: "model.denied",
          decisionCode: "model_not_in_allowlist",
          targetType: "model",
          targetId: normalizedModel,
          payload: {
            allowlist_size:
              allowlistState.status === "restricted"
                ? allowlistState.models.length
                : 0,
          },
        });
        throw new Error(MODEL_NOT_IN_ALLOWLIST_ERROR);
      }
    }

    const approvedGatewayFallbackModelIds = filterGatewayFallbackModelIds({
      candidates: options?.gatewayFallbackModelIds ?? [],
      capabilities,
      teamId,
      allowlistState,
    });

    const [{ allowPlatformAi }, userGatewayKey] = await Promise.all([
      deps.loadUserPlatformAccess(userId).catch(() => ({
        allowPlatformAi: false,
      })),
      deps.getProviderKey(userId, "ai_gateway", teamId),
    ]);
    if (userGatewayKey && !isOpenRouterModel) {
      return {
        model: deps.resolveGatewayModel(userGatewayKey, normalizedModel, {
          fetch: options?.providerFetch,
        }),
        providerOptions: gatewayProviderOptions(
          normalizedModel,
          options?.gatewayContext ?? { userId },
          approvedGatewayFallbackModelIds
        ),
      };
    }

    if (
      process.env.AI_GATEWAY_API_KEY &&
      allowPlatformAi &&
      !isOpenRouterModel
    ) {
      const providerOptions = gatewayProviderOptions(
        normalizedModel,
        options?.gatewayContext ?? { userId },
        approvedGatewayFallbackModelIds
      );
      if (options?.preferGatewayProviderObject) {
        return {
          model: deps.resolveGatewayModel(
            process.env.AI_GATEWAY_API_KEY,
            normalizedModel,
            {
              fetch: options.providerFetch,
            }
          ),
          providerOptions,
        };
      }
      return { model: normalizedModel, providerOptions };
    }

    if (provider === "openai" && providerModelId) {
      const apiKey = await deps.getProviderKey(userId, "openai", teamId);
      if (!apiKey) {
        throw new Error(
          process.env.AI_GATEWAY_API_KEY && !allowPlatformAi
            ? PLATFORM_OPENAI_ACCESS_ERROR
            : "No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key."
        );
      }
      return {
        model: deps.resolveOpenAIModel(apiKey, providerModelId, {
          fetch: options?.providerFetch,
        }),
      };
    }

    if (provider === "anthropic" && providerModelId) {
      const apiKey = await deps.getProviderKey(userId, "anthropic", teamId);
      if (!apiKey) {
        throw new Error(
          process.env.AI_GATEWAY_API_KEY && !allowPlatformAi
            ? PLATFORM_ANTHROPIC_ACCESS_ERROR
            : "No Anthropic API key configured. Add one in Settings > API Keys or configure an AI Gateway key."
        );
      }
      return {
        model: deps.resolveAnthropicModel(apiKey, providerModelId, {
          fetch: options?.providerFetch,
        }),
      };
    }

    if (provider === "openrouter" && providerModelId) {
      const apiKey = await deps.getProviderKey(userId, "openrouter", teamId);
      if (!apiKey) {
        throw new Error(
          process.env.AI_GATEWAY_API_KEY && !allowPlatformAi
            ? PLATFORM_OPENROUTER_ACCESS_ERROR
            : "No OpenRouter API key configured. Add one in Settings > API Keys or switch to an AI Gateway, OpenAI, or Anthropic model."
        );
      }
      // Append `:nitro` (OpenRouter throughput-sort shortcut) when no
      // `:variant` is already specified — mirrors gateway `sort: "tps"`.
      return {
        model: deps.resolveOpenRouterModel(
          apiKey,
          applyOpenRouterNitro(providerModelId),
          {
            fetch: options?.providerFetch,
          }
        ),
      };
    }

    throw new Error(
      process.env.AI_GATEWAY_API_KEY && !allowPlatformAi
        ? PLATFORM_AI_ACCESS_ERROR
        : `Model provider "${provider || normalizedModel}" is not supported without AI Gateway. Add an AI Gateway key in Settings > API Keys or switch to an OpenAI, Anthropic, or OpenRouter model.`
    );
  };
}

export const resolveUserLanguageModel = createResolveUserLanguageModel();
