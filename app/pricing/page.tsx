import type { Metadata } from "next";
import { CapacityPricingGrid } from "@/components/marketing/capacity-pricing-grid";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { CAPACITY_ADD_ONS } from "@/lib/billing/capacity-catalog";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Pricing for predictable agent capacity",
  description:
    "Choose an Individual plan by Concurrency, retained data, and hosted usage. Add capacity as your work grows.",
  path: "/pricing",
});

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const HOSTED_RATES = [
  {
    meter: "Managed services",
    rate: "1.25× provider cost",
    detail:
      "Covers managed AI, Trigger.dev, functions, email, storage operations, and transfer.",
  },
  {
    meter: "Sandbox runtime",
    rate: "$0.0075 per minute",
    detail: "Charged only while a hosted sandbox runs.",
  },
  {
    meter: "Sandbox transfer",
    rate: "$0.19 per GB",
    detail: "Snapshots also count toward retained data.",
  },
];

export default function PricingPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "CAPACITY THAT STAYS CLEAR",
        lines: ["Start with the room you need.", "Add more when work grows."],
        note: "one named user on Individual. shared company control is custom.",
      }}
    >
      <header className="sub-hero">
        <div className="hero-annot mono" aria-hidden>
          <span>MOGPLEX</span>
          <span className="annot-rule" />
          <span>PRICING · CAPACITY</span>
        </div>
        <h1 className="sub-title">Run more work. Know what it costs.</h1>
        <p className="sub-lede">
          Choose an Individual plan by Concurrency, retained data, and hosted
          usage. Add more capacity when you need it. You keep clear limits and
          avoid a surprise usage bill.
        </p>
        <p className="mono micro">
          one named user · visible limits · add capacity at any time
        </p>
      </header>

      <CapacityPricingGrid />

      <section className="meter-card" aria-labelledby="add-capacity">
        <p className="meter-kicker mono">CAPACITY ADD-ONS</p>
        <h2 className="meter-title" id="add-capacity">
          Add room. Keep your plan.
        </h2>
        <p className="capacity-section-lede">
          Buy recurring capacity from Billing. Changes show the new limit,
          price, and effective date before you confirm.
        </p>
        <div className="capacity-addon-groups">
          {(["concurrency", "retained_data"] as const).map((kind) => (
            <div key={kind}>
              <h3>{kind === "concurrency" ? "Concurrency" : "Retained data"}</h3>
              <ul>
                {CAPACITY_ADD_ONS.filter((addOn) => addOn.kind === kind).map(
                  (addOn) => (
                    <li key={addOn.lookupKey}>
                      <span>{addOn.name.replace(/^.*?\+/, "+")}</span>
                      <strong>{formatUsd(addOn.amountCents)}/month</strong>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="ent-card" aria-label="Company plans">
        <div className="ent-copy">
          <p className="meter-kicker mono">BUSINESS AND ENTERPRISE</p>
          <h2 className="meter-title">Give your company shared control.</h2>
          <p className="ent-lede">
            Company plans support shared ownership, governed access, custom
            capacity, invoiced billing, and security review. We shape the
            contract around your operating needs.
          </p>
        </div>
        <div className="ent-action">
          <a className="ent-cta mono" href="mailto:enterprise@mogplex.com">
            Contact sales
          </a>
          <p className="ent-note mono">business and enterprise are separate from Individual plans</p>
        </div>
      </section>

      <section className="meter-card" aria-labelledby="hosted-usage-rates">
        <p className="meter-kicker mono">HOSTED USAGE</p>
        <h2 className="meter-title" id="hosted-usage-rates">
          Pay for the managed work you use.
        </h2>
        <div className="meter-table mono" role="table">
          {HOSTED_RATES.map((row) => (
            <div className="meter-row" role="row" key={row.meter}>
              <span role="cell" className="meter-name">{row.meter}</span>
              <span role="cell" className="meter-rate">{row.rate}</span>
              <span role="cell" className="meter-detail">{row.detail}</span>
            </div>
          ))}
        </div>
        <p className="meter-foot mono">
          Bring your own AI key and your AI provider bills those model calls.
          Other hosted costs still use your hosted usage balance.
        </p>
      </section>

      <section className="terms" aria-label="Pricing details">
        <div className="terms-row">
          <div className="term">
            <p className="term-k mono">CLEAR LIMITS</p>
            <p className="term-v">
              Mogplex shows all three capacity limits together. Work pauses
              safely before it exceeds the capacity you bought.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">PURCHASED USAGE</p>
            <p className="term-v">
              Purchased hosted usage keeps its face value and never expires.
              Included hosted usage resets each month.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">SELF-HOST</p>
            <p className="term-v">
              The Apache-2.0 application has no license fee. You pay your own
              infrastructure providers when you self-host.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">ONE USER</p>
            <p className="term-v">
              Individual plans support one named user. Businesses use a
              company plan for shared ownership and access.
            </p>
          </div>
        </div>
      </section>
    </MarketingSubpageShell>
  );
}
