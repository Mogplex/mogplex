/**
 * A capacity schedule projection refused while the operations gate is off.
 * The Stripe webhook keeps the event claim for replay once the gate reopens,
 * so this is an expected state, not a fault. Payment paths that already
 * captured money throw a plain error instead, so they are still reported.
 */
export class CapacityBillingDisabledError extends Error {
  constructor() {
    super("Capacity billing operations are disabled");
    this.name = "CapacityBillingDisabledError";
  }
}
