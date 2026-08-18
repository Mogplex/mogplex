import {
  CAPACITY_STRIPE_PRODUCTS,
  capacityStripeCatalogDeps,
  syncCapacityStripeCatalog,
} from "../lib/billing/capacity-stripe-catalog";
import {
  areCapacityBillingOperationsEnabled,
  capacityBillingStripeMode,
  getStripe,
} from "../lib/billing/stripe";

async function main() {
  const arguments_ = process.argv.slice(2);
  const unknown = arguments_.filter((argument) => argument !== "--apply");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown.join(", ")}`);
  }
  if (!arguments_.includes("--apply")) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          liveWritesAuthorized: false,
          products: CAPACITY_STRIPE_PRODUCTS,
        },
        null,
        2
      )
    );
    return;
  }

  const operationsEnabled = areCapacityBillingOperationsEnabled();
  if (!operationsEnabled) {
    throw new Error("Capacity billing operations are disabled");
  }
  const mode = capacityBillingStripeMode();
  if (!mode) throw new Error("Capacity billing Stripe mode is unavailable");
  const result = await syncCapacityStripeCatalog({
    deps: capacityStripeCatalogDeps(getStripe()),
  });
  console.log(JSON.stringify({ mode, ...result }, null, 2));
}

// The repository compiles scripts as CommonJS, where top-level await is not
// available even though the CLI itself is asynchronous.
// eslint-disable-next-line unicorn/prefer-top-level-await
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
