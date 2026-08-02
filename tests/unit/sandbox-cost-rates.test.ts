import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateSandboxCostCents,
  getSandboxCostCentsPerSecond,
  hasSandboxCostRateOverride,
} from "../../lib/sandbox/cost-rates";

test("getSandboxCostCentsPerSecond defaults when env is unset", () => {
  assert.equal(getSandboxCostCentsPerSecond({}), 0.0028);
});

test("getSandboxCostCentsPerSecond honors a valid env override", () => {
  assert.equal(
    getSandboxCostCentsPerSecond({
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "0.005",
    }),
    0.005
  );
});

test("getSandboxCostCentsPerSecond ignores non-finite or non-positive overrides", () => {
  assert.equal(
    getSandboxCostCentsPerSecond({
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "nope",
    }),
    0.0028
  );
  assert.equal(
    getSandboxCostCentsPerSecond({
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "-1",
    }),
    0.0028
  );
  assert.equal(
    getSandboxCostCentsPerSecond({
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "0",
    }),
    0.0028
  );
});

test("hasSandboxCostRateOverride detects env var presence, not value equality", () => {
  assert.equal(hasSandboxCostRateOverride({}), false);
  assert.equal(
    hasSandboxCostRateOverride({ PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "" }),
    false
  );
  assert.equal(
    hasSandboxCostRateOverride({
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "nope",
    }),
    false
  );
  assert.equal(
    hasSandboxCostRateOverride({
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "0",
    }),
    false
  );
  // Setting the env to the default literal still counts as an operator
  // override — this is what the float-equality check used to miss.
  assert.equal(
    hasSandboxCostRateOverride({
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "0.0028",
    }),
    true
  );
  assert.equal(
    hasSandboxCostRateOverride({
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "0.005",
    }),
    true
  );
});

test("estimateSandboxCostCents returns 0 for non-positive compute seconds", () => {
  assert.equal(estimateSandboxCostCents(0), 0);
  assert.equal(estimateSandboxCostCents(-10), 0);
  assert.equal(estimateSandboxCostCents(Number.NaN), 0);
});

test("estimateSandboxCostCents multiplies seconds by rate and rounds to 4 decimals", () => {
  assert.equal(estimateSandboxCostCents(1000), 2.8);
  assert.equal(estimateSandboxCostCents(100), 0.28);
  assert.equal(
    estimateSandboxCostCents(1000, {
      PLATFORM_SANDBOX_COST_CENTS_PER_SECOND: "0.01",
    }),
    10
  );
});
