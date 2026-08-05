import type { Metadata } from "next";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import {
  PLAN_PRICES,
  SANDBOX_RATE_MICRO_USD_PER_MINUTE,
  TOPUP_PRESETS,
} from "@/lib/billing/catalog";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Pricing — tokens at cost, compute by the minute",
  description:
    "Three tiers, no seats. Model tokens at provider list price with zero markup, sandbox compute at a published per-minute rate, and every run itemized to the cent.",
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

function dollars(amountCents: number) {
  return `$${amountCents / 100}`;
}

function plan(lookupKey: string) {
  const match = PLAN_PRICES.find((price) => price.lookupKey === lookupKey);
  if (!match) throw new Error(`Missing billing catalog entry: ${lookupKey}`);
  return match;
}

const PRO_MONTHLY = plan("pro_monthly");
const PRO_ANNUAL = plan("pro_annual");
const TEAM_MONTHLY = plan("team_monthly");
const TEAM_ANNUAL = plan("team_annual");

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
    price: dollars(PRO_MONTHLY.amountCents),
    cadence: "per month",
    annual: `${dollars(PRO_ANNUAL.amountCents)}/yr — 20% off`,
    included: `${dollars(PRO_MONTHLY.includedUsageCents)}.00/mo usage included`,
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
    price: dollars(TEAM_MONTHLY.amountCents),
    cadence: "per month, flat",
    annual: `${dollars(TEAM_ANNUAL.amountCents)}/yr — 20% off`,
    included: `${dollars(TEAM_MONTHLY.includedUsageCents)}.00/mo pooled usage included`,
    audience: "Unlimited members. We charge for runs, not people.",
    features: [
      "No per-seat pricing. Members do not drive our costs. Runs do.",
      "Role-based access, the audit log, and billing stay in one place.",
      "Team usage analytics show the cost for each member.",
      "Usage is pooled across the whole team.",
    ],
    note: "No enterprise tier, no sales call. Need dedicated infrastructure? Self-host the open-source system. Read the self-hosting docs first. They explain the work involved.",
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

const TOPUPS = TOPUP_PRESETS.map((preset) => dollars(preset.amountCents));

export default function PricingPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "SHEET 06 — END",
        lines: ["Priced like infrastructure.", "Not like seats."],
        note: "every tier is self-serve. the whole rate card is on this page.",
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
          Every run shows its exact cost. No seats, no request quotas, no sales
          call.
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
          </article>
        ))}
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
              The system is Apache-2.0. Self-hosting is free forever and is our
              enterprise answer. There is no gated tier or demo call. The docs
              explain what self-hosting takes.
            </p>
          </div>
        </div>
      </section>
    </MarketingSubpageShell>
  );
}
