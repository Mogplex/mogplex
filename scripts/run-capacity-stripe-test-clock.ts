import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import type Stripe from "stripe";
import { findIndividualCapacityPrice } from "../lib/billing/capacity-catalog";
import {
  capacityStripeCatalogDeps,
  syncCapacityStripeCatalog,
} from "../lib/billing/capacity-stripe-catalog";
import {
  runCapacityStripeTestResource,
  runCapacityStripeTestClockCoverage,
  type CapacityStripeTestClockDeps,
  type CapacityStripeTestClockEventType,
  type CapacityStripeTestClockExpectation,
} from "../lib/billing/capacity-stripe-test-clock";
import {
  areCapacityBillingOperationsEnabled,
  getStripe,
} from "../lib/billing/stripe";

const EVENT_TYPES: readonly CapacityStripeTestClockEventType[] = [
  "charge.refunded",
  "invoice.paid",
  "invoice.payment_failed",
  "test_helpers.test_clock.ready",
];
const EVENT_TIMEOUT_MS = 120_000;

type Waiter = {
  expectation: CapacityStripeTestClockExpectation;
  resolve: (event: Stripe.Event) => void;
  reject: (error: Error) => void;
};

function referenceId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return typeof value.id === "string" ? value.id : null;
  }
  return null;
}

function eventMatches(
  event: Stripe.Event,
  expectation: CapacityStripeTestClockExpectation
): boolean {
  if (event.type !== expectation.type) return false;
  const object = event.data.object as unknown as Record<string, unknown>;
  if (expectation.clockId && object.id !== expectation.clockId) return false;
  if (
    expectation.customerId &&
    referenceId(object.customer) !== expectation.customerId
  ) {
    return false;
  }
  return true;
}

class StripeEventInbox {
  private readonly waiters = new Set<Waiter>();

  publish(event: Stripe.Event) {
    for (const waiter of this.waiters) {
      if (!eventMatches(event, waiter.expectation)) continue;
      this.waiters.delete(waiter);
      waiter.resolve(event);
    }
  }

  waitFor(
    expectation: CapacityStripeTestClockExpectation,
    signal: AbortSignal
  ): Promise<Stripe.Event> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { expectation, resolve, reject };
      const timeout = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for Stripe ${expectation.type}`));
      }, EVENT_TIMEOUT_MS);
      const finish = (callback: () => void) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        callback();
      };
      const abort = () => {
        this.waiters.delete(waiter);
        finish(() => reject(new Error("Stripe event capture was cancelled")));
      };
      waiter.resolve = (event) => finish(() => resolve(event));
      waiter.reject = (error) => finish(() => reject(error));
      signal.addEventListener("abort", abort, { once: true });
      this.waiters.add(waiter);
    });
  }

  async capture<T>(
    input: {
      expectations: readonly CapacityStripeTestClockExpectation[];
      scenario: string;
    },
    action: () => Promise<T>
  ): Promise<{ result: T; eventTypes: CapacityStripeTestClockEventType[] }> {
    const controller = new AbortController();
    const eventsPromise = Promise.all(
      input.expectations.map((expectation) =>
        this.waitFor(expectation, controller.signal)
      )
    );
    try {
      const [result, events] = await Promise.all([action(), eventsPromise]);
      return {
        result,
        eventTypes: events.map(
          (event) => event.type as CapacityStripeTestClockEventType
        ),
      };
    } catch (error) {
      controller.abort();
      await eventsPromise.catch(() => undefined);
      throw error;
    } finally {
      controller.abort();
    }
  }
}

function stripeEvent(value: unknown): Stripe.Event | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Stripe.Event>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.type !== "string" ||
    !candidate.data ||
    typeof candidate.data !== "object"
  ) {
    return null;
  }
  return candidate as Stripe.Event;
}

async function startEventServer(input: {
  inbox: StripeEventInbox;
  authorization: string;
}): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    if (
      request.method !== "POST" ||
      request.url !== "/stripe-events" ||
      request.headers.authorization !== input.authorization
    ) {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const event = stripeEvent(JSON.parse(Buffer.concat(chunks).toString()));
        if (!event) throw new TypeError("Invalid Stripe event");
        input.inbox.publish(event);
        response.writeHead(200).end();
      } catch {
        response.writeHead(400).end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}/stripe-events`,
  };
}

async function waitForCliReady(
  child: ChildProcessByStdio<null, Readable, Readable>
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => finish(() => reject(new Error("Stripe CLI did not become ready"))),
      30_000
    );
    const onData = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-16_384);
      if (output.includes("Ready!")) finish(resolve);
    };
    const onError = () =>
      finish(() => reject(new Error("Stripe CLI could not start")));
    const onClose = () =>
      finish(() => reject(new Error("Stripe CLI exited before it was ready")));
    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      child.stdout.removeListener("data", onData);
      child.stderr.removeListener("data", onData);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      callback();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
  child.stdout.resume();
  child.stderr.resume();
}

async function startStripeForwarder(secretKey: string): Promise<{
  inbox: StripeEventInbox;
  stop: () => Promise<void>;
}> {
  const inbox = new StripeEventInbox();
  const bearer = randomBytes(32).toString("hex");
  const authorization = `Bearer ${bearer}`;
  const { server, url } = await startEventServer({ inbox, authorization });
  const child = spawn(
    "stripe",
    [
      "listen",
      "--skip-update",
      "--color",
      "off",
      "--events",
      EVENT_TYPES.join(","),
      "--forward-to",
      url,
      "--headers",
      `Authorization: ${authorization}`,
    ],
    {
      env: { ...process.env, STRIPE_API_KEY: secretKey },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  try {
    await waitForCliReady(child);
  } catch (error) {
    child.kill("SIGTERM");
    server.close();
    throw error;
  }
  return {
    inbox,
    async stop() {
      const childClosed =
        child.exitCode === null ? once(child, "close") : Promise.resolve();
      if (child.exitCode === null) child.kill("SIGTERM");
      const serverClosed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await Promise.all([childClosed, serverClosed]);
    },
  };
}

function objectId(
  value: string | { id: string } | null | undefined,
  label: string
): string {
  const id = referenceId(value);
  if (!id) throw new TypeError(`Stripe ${label} is missing`);
  return id;
}

async function canonicalPriceId(
  stripe: Stripe,
  lookupKey: string
): Promise<string> {
  const expected = findIndividualCapacityPrice(lookupKey)?.price;
  if (!expected) throw new TypeError(`Unknown capacity plan ${lookupKey}`);
  const prices = await stripe.prices.list({
    active: true,
    lookup_keys: [lookupKey],
    limit: 2,
  });
  if (prices.data.length !== 1) {
    throw new TypeError(`Stripe price ${lookupKey} is missing or duplicated`);
  }
  const price = prices.data[0]!;
  if (
    price.currency !== "usd" ||
    price.unit_amount !== expected.amountCents ||
    price.recurring?.interval !== expected.interval
  ) {
    throw new TypeError(`Stripe price ${lookupKey} does not match the catalog`);
  }
  return price.id;
}

function stripeTestClockDeps(input: {
  stripe: Stripe;
  inbox: StripeEventInbox;
  runId: string;
}): CapacityStripeTestClockDeps {
  const metadata = (scenario: string) => ({
    capacity_test_run: input.runId,
    capacity_test_scenario: scenario,
  });
  return {
    async createClock(scenario, frozenAt) {
      const clock = await input.stripe.testHelpers.testClocks.create({
        frozen_time: frozenAt,
        name: `Mogplex ${scenario}`,
      });
      return clock.id;
    },
    async deleteClock(clockId) {
      await input.stripe.testHelpers.testClocks.del(clockId);
    },
    async createCustomer(clockId, scenario) {
      const customer = await input.stripe.customers.create({
        test_clock: clockId,
        payment_method: "pm_card_visa",
        invoice_settings: { default_payment_method: "pm_card_visa" },
        metadata: metadata(scenario),
      });
      return customer.id;
    },
    async createSubscription({ customerId, lookupKey, scenario }) {
      const priceId = await canonicalPriceId(input.stripe, lookupKey);
      const subscription = await input.stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId, quantity: 1 }],
        payment_behavior: "error_if_incomplete",
        metadata: metadata(scenario),
        expand: ["latest_invoice"],
      });
      return {
        invoiceId: objectId(subscription.latest_invoice, "initial invoice"),
      };
    },
    async advanceClock({ clockId, frozenAt }) {
      await input.stripe.testHelpers.testClocks.advance(clockId, {
        frozen_time: frozenAt,
      });
    },
    async useFailingPaymentMethod(customerId) {
      await input.stripe.paymentMethods.attach("pm_card_chargeCustomerFail", {
        customer: customerId,
      });
      await input.stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: "pm_card_chargeCustomerFail",
        },
      });
    },
    async refundInvoice(invoiceId, scenario) {
      const payments = await input.stripe.invoicePayments.list({
        invoice: invoiceId,
        status: "paid",
        limit: 10,
      });
      const paymentIntent = payments.data.find(
        (payment) => payment.payment.type === "payment_intent"
      )?.payment.payment_intent;
      const paymentIntentId = objectId(paymentIntent, "invoice payment intent");
      await input.stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: "requested_by_customer",
        metadata: metadata(scenario),
      });
    },
    reportCleanupFailure({ resource, scenario, error }) {
      console.error("[capacity-billing] Stripe test cleanup failed", {
        resource,
        scenario,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    },
    captureEvents: (capture, action) => input.inbox.capture(capture, action),
  };
}

function currentFrozenTime(): number {
  const now = Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new RangeError("Current time cannot seed a Stripe test clock");
  }
  return now;
}

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  if (!areCapacityBillingOperationsEnabled()) {
    throw new Error(
      "Capacity billing test operations require CAPACITY_BILLING_OPERATIONS_ENABLED=true and a Stripe test secret key"
    );
  }
  const stripe = getStripe();
  const catalog = await syncCapacityStripeCatalog({
    deps: capacityStripeCatalogDeps(stripe),
  });
  const forwarder = await startStripeForwarder(secretKey);
  await runCapacityStripeTestResource({
    async run() {
      const report = await runCapacityStripeTestClockCoverage({
        secretKey,
        frozenAt: currentFrozenTime(),
        deps: stripeTestClockDeps({
          stripe,
          inbox: forwarder.inbox,
          runId: randomBytes(12).toString("hex"),
        }),
      });
      console.log(JSON.stringify({ ...report, catalog }, null, 2));
    },
    cleanup: forwarder.stop,
    reportCleanupFailure(error) {
      console.error("[capacity-billing] Stripe forwarder cleanup failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });
}

// The repository compiles scripts as CommonJS, where top-level await is not
// available even though the CLI itself is asynchronous.
// eslint-disable-next-line unicorn/prefer-top-level-await
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
