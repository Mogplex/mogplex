/* eslint-disable unicorn/prefer-bigint-literals -- The ES6 TypeScript target rejects BigInt literal syntax. */

import { describe, expect, it } from "vitest";
import {
  MANAGED_SERVICE_FACTOR_MILLIONTHS,
  SANDBOX_RETAIL_MICROS_PER_MINUTE,
  SANDBOX_TRANSFER_RETAIL_MICROS_PER_GB,
  factorManagedServiceDebitMicros,
  fixedRetailDebitMicros,
  sandboxComputeRetailDebitMicros,
  sandboxTransferRetailDebitMicros,
} from "./provider-costs";

describe("provider cost retail pricing", () => {
  it("applies the approved 1.25 factor and rounds once to a microdollar", () => {
    expect(MANAGED_SERVICE_FACTOR_MILLIONTHS).toBe(BigInt(1_250_000));
    expect(factorManagedServiceDebitMicros(BigInt(8))).toBe(BigInt(10));
    expect(factorManagedServiceDebitMicros(BigInt(1))).toBe(BigInt(2));
    expect(factorManagedServiceDebitMicros(BigInt(0))).toBe(BigInt(0));
    expect(factorManagedServiceDebitMicros(BigInt(3), BigInt(1_000_000))).toBe(
      BigInt(3)
    );
  });

  it("prices sandbox compute at $0.0075 per minute", () => {
    expect(SANDBOX_RETAIL_MICROS_PER_MINUTE).toBe(BigInt(7_500));
    expect(sandboxComputeRetailDebitMicros(BigInt(60_000))).toBe(BigInt(7_500));
    expect(sandboxComputeRetailDebitMicros(BigInt(90_000))).toBe(
      BigInt(11_250)
    );
    expect(sandboxComputeRetailDebitMicros(BigInt(1))).toBe(BigInt(1));
  });

  it("prices sandbox transfer at $0.19 per decimal GB", () => {
    expect(SANDBOX_TRANSFER_RETAIL_MICROS_PER_GB).toBe(BigInt(190_000));
    expect(sandboxTransferRetailDebitMicros(BigInt(1_000_000_000))).toBe(
      BigInt(190_000)
    );
    expect(sandboxTransferRetailDebitMicros(BigInt(500_000_000))).toBe(
      BigInt(95_000)
    );
  });

  it("prices fractional fixed-rate units without floating point", () => {
    expect(fixedRetailDebitMicros(BigInt(10_000), BigInt(1_500_000))).toBe(
      BigInt(15_000)
    );
    expect(fixedRetailDebitMicros(BigInt(1), BigInt(1))).toBe(BigInt(1));
  });

  it("rejects negative amounts and nonpositive factors", () => {
    expect(() => factorManagedServiceDebitMicros(-BigInt(1))).toThrow(
      /must not be negative/
    );
    expect(() => factorManagedServiceDebitMicros(BigInt(1), BigInt(0))).toThrow(
      /must be positive/
    );
    expect(() => fixedRetailDebitMicros(-BigInt(1), BigInt(1))).toThrow(
      /must not be negative/
    );
    expect(() => fixedRetailDebitMicros(BigInt(1), -BigInt(1))).toThrow(
      /must not be negative/
    );
    expect(() => sandboxComputeRetailDebitMicros(-BigInt(1))).toThrow(
      /must not be negative/
    );
    expect(() => sandboxTransferRetailDebitMicros(-BigInt(1))).toThrow(
      /must not be negative/
    );
  });
});
