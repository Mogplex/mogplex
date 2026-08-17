/* eslint-disable unicorn/prefer-bigint-literals -- The ES6 TypeScript target rejects BigInt literal syntax. */

import {
  factorRetailDebitMicros,
  PROVIDER_COST_PRICING_VERSION,
} from "@/lib/billing/provider-costs";
import {
  recordShadowProviderCost,
  type ShadowProviderCostEvent,
} from "@/lib/billing/shadow-ledger";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TriggerCompletion = {
  runId: string;
  taskIdentifier: string;
  billingAccountId?: string | null;
  rootWorkflowRef?: string | null;
  totalCostInCents: number;
  durationMs: number;
  occurredAt: Date;
};

function triggerCostMicros(totalCostInCents: number): bigint {
  if (!Number.isFinite(totalCostInCents) || totalCostInCents < 0) {
    throw new RangeError("Trigger.dev cost must be a nonnegative number");
  }
  const micros = Math.ceil(totalCostInCents * 10_000);
  if (!Number.isSafeInteger(micros)) {
    throw new RangeError("Trigger.dev cost exceeds the safe integer range");
  }
  return BigInt(micros);
}

export function buildTriggerProviderCostEvent(
  completion: TriggerCompletion
): ShadowProviderCostEvent {
  const providerCostMicros = triggerCostMicros(completion.totalCostInCents);
  const accountId = completion.billingAccountId?.trim();
  const ownedAccountId = accountId && UUID.test(accountId) ? accountId : null;
  return {
    provider: "trigger.dev",
    providerEventId: completion.runId,
    costSource: "trigger",
    owner: ownedAccountId
      ? { accountId: ownedAccountId }
      : { sharedOverheadCategory: "platform_operations" },
    providerCostMicros,
    normalizedCostMicros: providerCostMicros,
    retailDebitMicros: ownedAccountId
      ? factorRetailDebitMicros(providerCostMicros)
      : BigInt(0),
    billingTreatment: ownedAccountId ? "hosted_usage" : "shared_overhead",
    pricingRuleVersion: PROVIDER_COST_PRICING_VERSION,
    measuredQuantity: String(completion.durationMs),
    measuredUnit: "millisecond",
    occurredAt: completion.occurredAt,
    refs: {
      runRef: completion.runId,
      rootWorkflowRef: completion.rootWorkflowRef ?? undefined,
    },
    metadata: { taskIdentifier: completion.taskIdentifier },
  };
}

export function recordTriggerProviderCost(
  completion: TriggerCompletion,
  recorder: typeof recordShadowProviderCost = recordShadowProviderCost
) {
  return recorder(buildTriggerProviderCostEvent(completion));
}
