"use client";

import { useState } from "react";
import Link from "next/link";
import {
  INDIVIDUAL_CAPACITY_PLANS,
  LOGICAL_BYTES_PER_GB,
  type CapacityPlanInterval,
} from "@/lib/billing/capacity-catalog";
import { signupPath } from "@/lib/billing/plan-intent";

const PLANS = Object.values(INDIVIDUAL_CAPACITY_PLANS);

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function CapacityPricingGrid() {
  const [interval, setInterval] = useState<CapacityPlanInterval>("month");

  return (
    <section className="capacity-plans" aria-labelledby="individual-plans">
      <div className="capacity-section-head">
        <div>
          <p className="meter-kicker mono">INDIVIDUAL PLANS</p>
          <h2 className="meter-title" id="individual-plans">
            Choose the room you need now.
          </h2>
          <p className="capacity-section-lede">
            Every Individual plan is for one named user. Upgrade capacity
            without moving into a company contract.
          </p>
        </div>
        <div className="capacity-toggle" role="group" aria-label="Billing period">
          <button
            aria-pressed={interval === "month"}
            onClick={() => setInterval("month")}
            type="button"
          >
            Monthly
          </button>
          <button
            aria-pressed={interval === "year"}
            onClick={() => setInterval("year")}
            type="button"
          >
            Annual, save 15%
          </button>
        </div>
      </div>

      <div className="price-cards">
        {PLANS.map((plan, index) => {
          const price = plan.prices[interval];
          return (
            <article className="price-card" key={plan.code}>
              <p className="price-num mono">
                PLAN {String(index + 1).padStart(2, "0")} · {plan.name.toUpperCase()}
              </p>
              <p className="price-value">
                {formatUsd(price.amountCents)}
                <span> /{interval === "month" ? "month" : "year"}</span>
              </p>
              <p className="price-annual mono">
                {interval === "year"
                  ? `${formatUsd(Math.round(price.amountCents / 12))} average per month`
                  : `${formatUsd(plan.prices.year.amountCents)} billed annually`}
              </p>
              <p className="price-included mono">1 named user</p>
              <dl className="capacity-allowances">
                <div>
                  <dt>Concurrency</dt>
                  <dd>{plan.concurrency}</dd>
                </div>
                <div>
                  <dt>Retained data</dt>
                  <dd>{plan.retainedDataBytes / LOGICAL_BYTES_PER_GB} GB</dd>
                </div>
                <div>
                  <dt>Hosted usage</dt>
                  <dd>{formatUsd(plan.hostedUsageCents)}/month</dd>
                </div>
              </dl>
              <p className="price-note mono">
                Included hosted usage resets monthly. Purchased hosted usage
                never expires.
              </p>
              <Link
                className="mpx-button is-primary price-cta"
                href={signupPath(plan.code)}
                data-testid={`pricing-cta-${plan.code}`}
              >
                Choose {plan.name}
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
