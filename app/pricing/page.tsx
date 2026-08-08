import type { Metadata } from "next";
import Link from "next/link";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import {
  formatUsd,
  PLAN_PRICES,
  SANDBOX_RATE_MICRO_USD_PER_MINUTE,
  TOPUP_PRESETS,
} from "@/lib/billing/catalog";
import {
  formatPerMillion,
  getPublicModelRates,
} from "@/lib/models/public-pricing";
import { buildMarketingMetadata } from "@/lib/seo";

// The per-model rate table re-syncs from the gateway catalog hourly.
export const revalidate = 3600;

export const metadata: Metadata = buildMarketingMetadata({
  title: "Pricing — tokens at cost, compute by the minute",
  description:
    "Four self-serve tiers plus enterprise, no seats. Model tokens at provider list price with zero markup, sandbox compute at a published per-minute rate, and every run itemized to the cent.",
  path: "/pricing",
});

type Tier = {
  key: string;
  name: string;
  price: string;
  cadence: string;
  annual?: string;
  included: string;
  audience: string;
  features: string[];
  note: string;
};

function plan(lookupKey: string) {
  const match = PLAN_PRICES.find((price) => price.lookupKey === lookupKey);
  if (!match) throw new Error(`Missing billing catalog entry: ${lookupKey}`);
  return match;
}

const PRO_MONTHLY = plan("pro_monthly");
const PRO_ANNUAL = plan("pro_annual");
const TEAM_MONTHLY = plan("team_monthly");
const TEAM_ANNUAL = plan("team_annual");
const BUSINESS_MONTHLY = plan("business_monthly");
const BUSINESS_ANNUAL = plan("business_annual");

const TIERS: Tier[] = [
  {
    key: "00",
    name: "PAYG",
    price: "$0",
    cadence: "/mo · pay as you go",
    included: "no monthly fee — pay the published rates and nothing else",
    audience: "Evaluate, bring your own key, or self-host.",
    features: [
      "Bring your own AI Gateway key. Your provider bills the tokens, not Mogplex.",
      "Sandbox compute stays on the meter. A $10 top-up buys 2,000 sandbox-minutes.",
      "Your prepaid balance is in dollars. Purchased balance never expires.",
      "Self-hosting is free forever. The whole system is Apache-2.0.",
    ],
    note: "Runs pause when your balance reaches zero, with a clear message. Nothing is deleted.",
  },
  {
    key: "01",
    name: "Pro",
    price: formatUsd(PRO_MONTHLY.amountCents),
    cadence: "per month",
    annual: `${formatUsd(PRO_ANNUAL.amountCents)}/yr — 20% off`,
    included: `${formatUsd(PRO_MONTHLY.includedUsageCents)}/mo usage included`,
    audience: "For the indie developer who ships with agents each day.",
    features: [
      "Mogplex gives you model access. You do not need to set up API keys.",
      "Included usage covers tokens at list price and sandbox minutes.",
      "Use every trigger and gate from the cloud app or CLI.",
      "Included usage resets monthly. Top-up balance rolls over forever.",
    ],
    note: "Every run shows its itemized cost: token spend and sandbox minutes, to the cent.",
  },
  {
    key: "02",
    name: "Team",
    price: formatUsd(TEAM_MONTHLY.amountCents),
    cadence: "per month, flat",
    annual: `${formatUsd(TEAM_ANNUAL.amountCents)}/yr — 20% off`,
    included: `${formatUsd(TEAM_MONTHLY.includedUsageCents)}/mo pooled usage included`,
    audience: "Unlimited members. We charge for runs, not people.",
    features: [
      "No per-seat pricing. Members do not drive our costs. Runs do.",
      "Role-based access, the audit log, and billing stay in one place.",
      "Team usage analytics show the cost for each member.",
      "Usage is pooled across the whole team.",
    ],
    note: "Outgrow the included usage? Top-ups never expire, or step up to Mog Mode.",
  },
  {
    key: "03",
    name: "Mog Mode",
    price: formatUsd(BUSINESS_MONTHLY.amountCents),
    cadence: "per month, flat",
    annual: `${formatUsd(BUSINESS_ANNUAL.amountCents)}/yr — 20% off`,
    included: `${formatUsd(BUSINESS_MONTHLY.includedUsageCents)}/mo pooled usage included`,
    audience: "For teams that run agents all day, every day.",
    features: [
      "Everything in Team: roles, the audit log, one pooled balance.",
      "Twice the included usage of Team, pooled across the org.",
      "Priority sandbox scheduling when capacity is tight.",
      "Priority support from the people who build Mogplex.",
    ],
    note: "Still self-serve, still no sales call. Need more than this? Enterprise is below.",
  },
];

type Meter = {
  meter: string;
  rate: string;
  detail: string;
};

const METERS: Meter[] = [
  {
    meter: "Model tokens",
    rate: "Provider list price · 0% markup",
    detail:
      "We use the per-model rate that your provider publishes for input, output, and cache classes. The Gateway reconciles each generation. We do not estimate the cost.",
  },
  {
    meter: "Sandbox compute",
    rate: `$${SANDBOX_RATE_MICRO_USD_PER_MINUTE / 1_000_000} / running-minute`,
    detail:
      "$0.30 an hour, with a one-minute minimum per session. The meter runs only while the sandbox runs. Pause or stop the sandbox, and the meter stops.",
  },
  {
    meter: "Sandbox lifecycle",
    rate: "No separate fee",
    detail:
      "Creation, snapshots, and resume have no line-item fee. Active time still uses the running-minute meter.",
  },
];

const TOPUPS = TOPUP_PRESETS.map((preset) => formatUsd(preset.amountCents));

export default async function PricingPage() {
  const modelRates = await getPublicModelRates();

  return (
    <MarketingSubpageShell
      close={{
        kicker: "SHEET 06 — END",
        lines: ["Priced like infrastructure.", "Not like seats."],
        note: "every plan is self-serve. enterprise is one email, not a demo gauntlet.",
      }}
    >
      <header className="sub-hero">
        <div className="hero-annot mono" aria-hidden>
          <span>MOGPLEX</span>
          <span className="annot-rule" />
          <span>SHEET 06 — RATE CARD</span>
        </div>
        <h1 className="sub-title">
          Tokens at cost. <em className="grad">Compute by the minute.</em>
        </h1>
        <p className="sub-lede">
          Two things cost real money when an agent ships a PR: model tokens and
          the sandbox it runs in. We bill both at published rates. Tokens pass
          through at API price with no markup. Compute is half a cent a minute.
          Every run shows its exact cost. No seats, no request quotas. A sales
          call only if you ask for one.
        </p>
        <p className="mono micro">
          launch pricing · start on payg, upgrade when the meter says so
        </p>
      </header>

      <section className="price-cards" aria-label="Plans">
        {TIERS.map((tier) => (
          <article className="price-card" key={tier.key}>
            <p className="price-num mono">
              TIER {tier.key} — {tier.name.toUpperCase()}
            </p>
            <p className="price-value">
              {tier.price}
              <span> {tier.cadence}</span>
            </p>
            {tier.annual ? (
              <p className="price-annual mono">{tier.annual}</p>
            ) : (
              <p className="price-annual mono">&nbsp;</p>
            )}
            <p className="price-included mono">{tier.included}</p>
            <p className="price-audience">{tier.audience}</p>
            <ul className="price-features">
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <p className="price-note mono">▪ {tier.note}</p>
            <Link
              className="mpx-button is-primary price-cta"
              href="/signup"
              data-testid={`pricing-cta-${tier.key}`}
            >
              Start now
            </Link>
          </article>
        ))}
      </section>

      <section className="ent-card" aria-label="Enterprise">
        <div className="ent-copy">
          <p className="meter-kicker mono">TIER 04 — ENTERPRISE</p>
          <h2 className="meter-title">
            Need more? <em className="grad">Contact us.</em>
          </h2>
          <p className="ent-lede">
            Dedicated capacity, custom terms, invoiced billing, security
            review, or help with an air-gapped self-host deployment. Tell us
            what you need. You talk to the people who build Mogplex, not a
            sales team.
          </p>
        </div>
        <div className="ent-action">
          <a className="ent-cta mono" href="mailto:enterprise@mogplex.com">
            enterprise@mogplex.com
          </a>
          <p className="ent-note mono">
            self-hosting stays free forever — enterprise is for teams that
            want us in the loop
          </p>
        </div>
      </section>

      <section className="meter-card" aria-label="Published rate card">
        <p className="meter-kicker mono">THE METER — PUBLISHED RATES</p>
        <h2 className="meter-title">
          One rate card, <em className="grad">no fine print</em>.
        </h2>
        <div className="meter-table mono" role="table">
          {METERS.map((row) => (
            <div className="meter-row" role="row" key={row.meter}>
              <span role="cell" className="meter-name">
                {row.meter}
              </span>
              <span role="cell" className="meter-rate">
                {row.rate}
              </span>
              <span role="cell" className="meter-detail">
                {row.detail}
              </span>
            </div>
          ))}
        </div>
        <p className="meter-foot mono">
          top-ups: {TOPUPS.join(" · ")} — prepaid, dollar-denominated,{" "}
          <b>never expire</b>. balance reads &ldquo;$13.42 remaining&rdquo;, not
          invented credits.
        </p>
      </section>

      {modelRates.length > 0 ? (
        <section className="meter-card" aria-label="Per-model token rates">
          <p className="meter-kicker mono">TOKENS — EVERY MODEL, LIST PRICE</p>
          <h2 className="meter-title">
            The full token table, <em className="grad">zero markup</em>.
          </h2>
          <div className="model-table mono" role="table">
            <div className="model-row model-head" role="row">
              <span role="columnheader">Model</span>
              <span role="columnheader">Provider</span>
              <span role="columnheader">Input / M tokens</span>
              <span role="columnheader">Output / M tokens</span>
            </div>
            {modelRates.map((model) => (
              <div className="model-row" role="row" key={model.id}>
                <span role="cell" className="model-name">
                  {model.name}
                </span>
                <span role="cell" className="model-provider">
                  {model.provider}
                </span>
                <span role="cell" className="model-rate">
                  {formatPerMillion(model.inputPerMillion)}
                </span>
                <span role="cell" className="model-rate">
                  {formatPerMillion(model.outputPerMillion)}
                </span>
              </div>
            ))}
          </div>
          <p className="meter-foot mono">
            synced from the gateway model catalog. the rate you see is the
            rate the provider publishes — <b>we add nothing</b>.
          </p>
        </section>
      ) : null}

      <section className="terms" aria-label="Pricing principles">
        <div className="terms-row">
          <div className="term">
            <p className="term-k mono">NO SEATS</p>
            <p className="term-v">
              Team is flat-rate with unlimited members. A new teammate costs
              you nothing. Runs are the unit of cost, so runs are the unit of
              billing.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">NO MARKUP</p>
            <p className="term-v">
              Tokens pass through at provider list price. Our margin comes from
              the compute we run, at the rate on this page.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">PREPAID</p>
            <p className="term-v">
              Your prepaid balance is in dollars. You do not get a surprise
              usage invoice. Purchased balance never expires.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">OPEN SOURCE</p>
            <p className="term-v">
              The system is Apache-2.0. Self-hosting is free forever, and the
              docs explain what it takes. Enterprise exists for teams that want
              us in the loop — it starts with an email, not a demo call.
            </p>
          </div>
        </div>
      </section>
    </MarketingSubpageShell>
  );
}
