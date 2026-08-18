/* eslint-disable unicorn/prefer-bigint-literals -- The ES6 TypeScript target rejects BigInt literal syntax. */

// Model inference is billed separately at the provider's published cost.
// This factor applies only to non-AI managed services such as Trigger.dev.
export const MANAGED_SERVICE_FACTOR_MILLIONTHS = BigInt(1_250_000);
export const SANDBOX_RETAIL_MICROS_PER_MINUTE = BigInt(7_500);
export const SANDBOX_TRANSFER_RETAIL_MICROS_PER_GB = BigInt(190_000);
export const PROVIDER_COST_PRICING_VERSION = "capacity_v2_2026_08_16";

const ONE_MILLION = BigInt(1_000_000);

function requireNonnegative(value: bigint, label: string): void {
  if (value < BigInt(0)) throw new RangeError(`${label} must not be negative`);
}

function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) {
    throw new RangeError("denominator must be positive");
  }
  if (numerator === BigInt(0)) return BigInt(0);
  return (numerator + denominator - BigInt(1)) / denominator;
}

export function factorManagedServiceDebitMicros(
  normalizedProviderCostMicros: bigint,
  factorMillionths: bigint = MANAGED_SERVICE_FACTOR_MILLIONTHS
): bigint {
  requireNonnegative(normalizedProviderCostMicros, "provider cost");
  if (factorMillionths <= BigInt(0)) {
    throw new RangeError("managed service factor must be positive");
  }
  return divideRoundUp(
    normalizedProviderCostMicros * factorMillionths,
    ONE_MILLION
  );
}

// quantityMillionths represents a fractional billing unit without floating
// point. For example, 1.5 minutes is 1_500_000 quantity millionths.
export function fixedRetailDebitMicros(
  rateMicrosPerUnit: bigint,
  quantityMillionths: bigint
): bigint {
  requireNonnegative(rateMicrosPerUnit, "retail rate");
  requireNonnegative(quantityMillionths, "measured quantity");
  return divideRoundUp(rateMicrosPerUnit * quantityMillionths, ONE_MILLION);
}

export function sandboxComputeRetailDebitMicros(
  durationMilliseconds: bigint
): bigint {
  requireNonnegative(durationMilliseconds, "sandbox duration");
  return divideRoundUp(
    SANDBOX_RETAIL_MICROS_PER_MINUTE * durationMilliseconds,
    BigInt(60_000)
  );
}

export function sandboxTransferRetailDebitMicros(bytes: bigint): bigint {
  requireNonnegative(bytes, "sandbox transfer bytes");
  return divideRoundUp(
    SANDBOX_TRANSFER_RETAIL_MICROS_PER_GB * bytes,
    BigInt(1_000_000_000)
  );
}
