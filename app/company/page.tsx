import type { Metadata } from "next";
import Link from "next/link";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Company — Mogplex",
  description:
    "Mogplex Inc. builds the open-source agentic software factory: agents that plan, build, review, and ship code through one inspectable pipeline, behind your gates.",
  path: "/company",
});

const GITHUB_URL = "https://github.com/mogplex/mogplex";

const PRINCIPLES = [
  {
    num: "PRINCIPLE 01",
    name: "Agents are infrastructure, not assistants.",
    desc: "Delegation is a transaction: you ask, it answers, and when you stop asking, everything stops. A factory is infrastructure: you wire it once and work keeps flowing through it — while you sleep, while you build something else. We build the second thing.",
  },
  {
    num: "PRINCIPLE 02",
    name: "Autonomy is a dial, not a default.",
    desc: "Every run ends at your gates. Branch protections rule, required reviews hold, and approval is designed into the pipeline — not bolted on after an incident. Teams start at draft-PR-only and loosen exactly as far as the audit trail earns it.",
  },
  {
    num: "PRINCIPLE 03",
    name: "Trust requires inspection.",
    desc: "You wouldn't trust a deploy pipeline you couldn't inspect, and an agent pipeline deserves more scrutiny, not less. Every model call and tool call is metered and logged; every run answers “what asked for this, what did the work, what did it cost, who approved it.”",
  },
  {
    num: "PRINCIPLE 04",
    name: "Open source is the trust model.",
    desc: "Code that authenticates against your repositories should be readable before you run it. The factory is Apache-2.0 on GitHub — read it, file issues against it, send patches to it. Scrutiny is the point.",
  },
];

const FACTS = [
  {
    k: "COMPANY",
    v: <>Mogplex Inc. Builders of the open-source agentic software factory.</>,
  },
  {
    k: "CODE",
    v: (
      <>
        Apache-2.0, at <a href={GITHUB_URL}>github.com/mogplex/mogplex</a>.
      </>
    ),
  },
  {
    k: "STATUS",
    v: (
      <>
        Private beta — approving teams in batches.{" "}
        <Link href="/request-access">Request access</Link>.
      </>
    ),
  },
  {
    k: "CONTACT",
    v: (
      <>
        <a href="mailto:enterprise@mogplex.com">enterprise@mogplex.com</a> for
        sales; <a href={`${GITHUB_URL}/issues`}>GitHub issues</a> for everything
        else.
      </>
    ),
  },
];

export default function CompanyPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "SHEET 05 — END",
        lines: ["Read the code.", "Then wire a run."],
        note: "the factory is open source. the beta is gated. both on purpose.",
      }}
    >
      <header className="sub-hero">
        <div className="hero-annot mono" aria-hidden>
          <span>MOGPLEX</span>
          <span className="annot-rule" />
          <span>SHEET 05 — COMPANY</span>
        </div>
        <h1 className="sub-title">
          The company behind the <em className="grad">factory</em>.
        </h1>
        <p className="sub-lede">
          Mogplex Inc. builds the open-source agentic software factory:
          infrastructure that takes intent — GitHub events, schedules, Slack
          asks — and turns it into <strong>reviewed, running code</strong>{" "}
          through agents your policies control. Not a coding assistant, not a
          CI add-on: the full pipeline from plan to deploy, inspectable at
          every station.
        </p>
        <p className="mono micro">
          MOGPLEX INC. · OPEN SOURCE · PRIVATE BETA
        </p>
      </header>

      <section className="patterns" aria-label="Operating principles">
        {PRINCIPLES.map((p) => (
          <article className="pattern" key={p.num}>
            <span className="node" aria-hidden />
            <div>
              <p className="pattern-num" aria-hidden>
                {p.num}
              </p>
              <h2 className="pattern-name">{p.name}</h2>
            </div>
            <div>
              <p className="pattern-desc">{p.desc}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="terms" aria-label="Company facts">
        <div className="terms-row">
          {FACTS.map((f) => (
            <div key={f.k}>
              <p className="term-k mono">{f.k}</p>
              <p className="term-v">{f.v}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingSubpageShell>
  );
}
