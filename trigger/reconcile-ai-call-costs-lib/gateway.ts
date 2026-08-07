import type {
  AggregateGatewayCostResult,
  GatewayGenerationInfoClient,
} from "./types";

export function getGatewayCost(info: unknown): number | null {
  if (!info || typeof info !== "object") return null;
  const value =
    "totalCost" in info
      ? info.totalCost
      : "cost" in info
        ? info.cost
        : undefined;

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

/**
 * Fetch cost from Gateway for multiple generation IDs and sum them.
 * Returns null if any ID returns 404 (incomplete data).
 * Throws on other errors.
 *
 * Parallel fetch - happy path is one RTT regardless of step count.
 * Trade-off: a row that will skip on its first 404 still spends API calls on
 * the remaining IDs. Acceptable because 404s on multi-step rows are rare (all
 * IDs are written atomically) and the latency win on the common case dominates.
 */
export async function fetchAggregateGatewayCost(
  gateway: GatewayGenerationInfoClient,
  generationIds: string[]
): Promise<AggregateGatewayCostResult | null> {
  if (generationIds.length === 0) {
    return null;
  }

  // Fetch all generation info in parallel
  const results = await Promise.allSettled(
    generationIds.map((id) => gateway.getGenerationInfo({ id }))
  );

  let totalCost = 0;
  let resolvedCount = 0;
  let anyMissingCost = false;
  let anyNotFound = false;

  for (const result of results) {
    if (result.status === "rejected") {
      if (isNotFoundError(result.reason)) {
        anyNotFound = true;
      } else {
        throw result.reason;
      }
    } else {
      // Count HTTP 200 responses as resolved, regardless of whether cost is present.
      // This makes resolved_count consistent across both incomplete paths: 404s vs missing cost.
      resolvedCount += 1;
      const cost = getGatewayCost(result.value);
      if (cost === null) {
        anyMissingCost = true;
      } else {
        totalCost += cost;
      }
    }
  }

  // If any ID returned 404 or has no cost yet, we have incomplete data.
  // Skip this row entirely until all IDs are ready to avoid partial sums.
  if (anyNotFound) {
    return {
      status: "incomplete",
      reason: "not_found",
      resolvedCount,
      totalCount: generationIds.length,
    };
  }
  if (anyMissingCost) {
    return {
      status: "incomplete",
      reason: "missing_cost",
      resolvedCount,
      totalCount: generationIds.length,
    };
  }

  // Round to 8 decimal places to match the NUMERIC(14, 8) column type and avoid
  // IEEE-754 floating-point summation artifacts (e.g. 0.05 + 0.08 + 0.04 = 0.16999999999999998).
  const roundedCost = Math.round(totalCost * 1e8) / 1e8;

  return {
    status: "complete",
    totalCost: roundedCost,
    firstId: generationIds[0],
  };
}

export function gatewayCostUpdateFilter(generationId: string) {
  // Supabase .or() accepts raw PostgREST syntax, so only interpolate literal-safe ids.
  if (!/^[A-Za-z0-9_-]+$/.test(generationId)) {
    throw new Error("Invalid Gateway generation id for ai_call cost update");
  }

  return `cost_source.isdistinct.gateway,gateway_generation_id.isdistinct.${generationId}`;
}
