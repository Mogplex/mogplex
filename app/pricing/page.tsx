import type { Metadata } from "next";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Pricing — tokens at cost, compute by the minute",
  description:
    "Three tiers, no seats. Model tokens at provider list price with zero markup, sandbox compute at $0.005 per running minute, and every run itemized to the cent.",
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

const TIERS: Tier[] = [
  {
    key: "00",
    name: "Free",
    price: "$0",
    cadence: "forever",
    included: "$5.00/mo sandbox compute included",
    audience: "Evaluate, bring your own key, or self-host.",
    features: [
      "BYOK via your AI Gateway key — tokens billed by your provider, never by us",
      "About 1,000 sandbox-minutes a month at the public rate",
      "Top-ups work on Free; purchased balance never expires",
      "Self-hosting is free forever — the whole platform is open source",
    ],
    note: "When the allowance runs out, runs pause with a clear message. Nothing is deleted.",
  },
  {
    key: "01",
    name: "Pro",
    price: "$20",
    cadence: "per month",
    annual: "$192/yr — 20% off",
    included: "$20.00/mo usage included",
    audience: "For the indie dev shipping with agents daily.",
    features: [
      "Mogplex-provided model access — no API keys to set up",
      "Included usage covers tokens at list price and sandbox minutes",
      "All features: every trigger, every gate, cloud + CLI",
      "Included usage resets monthly; top-up balance rolls over forever",
    ],
    note: "Every run shows its exact itemized cost — token spend and sandbox minutes, to the cent.",
  },
  {
    key: "02",
    name: "Team",
    price: "$100",
    cadence: "per month, flat",
    annual: "$960/yr — 20% off",
    included: "$100.00/mo pooled usage included",
    audience: "Unlimited members. We charge for runs, not people.",
    features: [
      "No per-seat pricing — members don't drive our costs, runs do",
      "RBAC, audit log, centralized billing in one place",
      "Org-wide usage analytics with per-member cost attribution",
      "Usage pooled across the whole org",
    ],
    note: "No enterprise tier, no sales call. Need dedicated infra? It's open source — self-host it.",
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
      "Billed at the exact per-model rate your provider publishes, per input, output, and cache class. Your cost is reconciled per generation from the Gateway — not estimated.",
  },
  {
    meter: "Sandbox compute",
    rate: "$0.005 / running-minute",
    detail:
      "$0.30 an hour, one-minute minimum per session. The meter runs only while the sandbox is running — pause or stop and it halts.",
  },
  {
    meter: "Sandbox creation · snapshots · resume",
    rate: "$0",
    detail: "Boots, snapshots, and resumes are on us.",
  },
];

const TOPUPS = ["$10", "$25", "$100", "custom (min $10)"];

export default function PricingPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "SHEET 06 — END",
        lines: ["Priced like infrastructure.", "Not like seats."],
        note: "private beta, approving in batches. usage is on us while we learn what you need.",
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
          the sandbox they run in. We bill both at published rates —{" "}
          <strong>tokens at API price with no markup</strong>, compute at half a
          cent a minute — and show you every run&apos;s exact cost. No seats, no
          request quotas, no sales call.
        </p>
        <p className="mono micro">
          launch pricing · during the private beta, usage is on us
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
          <b>never expire</b>. optional auto top-up. balance reads
          &ldquo;$13.42 remaining&rdquo;, not invented credits.
        </p>
      </section>

      <section className="terms" aria-label="Pricing principles">
        <div className="terms-row">
          <div className="term">
            <p className="term-k mono">NO SEATS</p>
            <p className="term-v">
              Team is flat-rate with unlimited members. Adding a teammate costs
              you nothing — runs are the unit of cost, so runs are the unit of
              billing.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">NO MARKUP</p>
            <p className="term-v">
              Tokens pass through at provider list price. Our margin lives on
              the compute we actually run, at a rate published right here.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">PREPAID</p>
            <p className="term-v">
              Balance-based, in dollars. No surprise invoices, no dunning.
              Budget caps are yours to set — we never invent limits for you.
            </p>
          </div>
          <div className="term">
            <p className="term-k mono">OPEN SOURCE</p>
            <p className="term-v">
              The control plane is open source. Self-hosting is free forever
              and is our enterprise answer — no gated tier, no demo call.
            </p>
          </div>
        </div>
      </section>
    </MarketingSubpageShell>
  );
}
