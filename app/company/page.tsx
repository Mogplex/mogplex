import type { Metadata } from "next";
import Link from "next/link";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Company — Mogplex",
  description:
    "Mogplex Inc. makes the open-source system that builds and maintains software. Agents plan, build, review, and ship code through one inspectable pipeline, behind your gates.",
  path: "/company",
});

const GITHUB_URL = "https://github.com/mogplex/mogplex";

const PRINCIPLES = [
  {
    num: "PRINCIPLE 01",
    name: "Agents are infrastructure, not assistants.",
    desc: "Delegation is a transaction: you ask, it answers, and when you stop asking, everything stops. Infrastructure is different. You wire it once. Work continues while you sleep or build something else. We build the second thing.",
  },
  {
    num: "PRINCIPLE 02",
    name: "Autonomy is a dial, not a default.",
    desc: "Every run ends at your gates. Branch protections rule, required reviews hold, and approval lives in the pipeline design. Teams start with draft PRs only. They loosen the gates only when the audit trail earns it.",
  },
  {
    num: "PRINCIPLE 03",
    name: "Trust requires inspection.",
    desc: "You would not trust a deploy pipeline you could not inspect. An agent pipeline needs more scrutiny, not less. The system meters and logs every model call and tool call. Every run shows what asked for the work, what did it, what it cost, and who approved it.",
  },
  {
    num: "PRINCIPLE 04",
    name: "Open source is the trust model.",
    desc: "Code that authenticates against your repositories must be readable before you run it. The system is Apache-2.0 on GitHub. Read it, file issues, and send patches. Scrutiny is the point.",
  },
];

const FACTS = [
  {
    k: "COMPANY",
    v: <>Mogplex Inc. Builders of the open-source system that builds and maintains software.</>,
  },
  {
    k: "CODE",
    v: (
      <>
        Apache-2.0: <a href={GITHUB_URL}>github.com/mogplex/mogplex</a>.
      </>
    ),
  },
  {
    k: "STATUS",
    v: (
      <>
        Generally available. <Link href="/signup">Sign up and wire a run</Link>.
      </>
    ),
  },
  {
    k: "CONTACT",
    v: (
      <>
        <a href="mailto:enterprise@mogplex.com">enterprise@mogplex.com</a> for
        commercial questions. <a href={`${GITHUB_URL}/issues`}>GitHub issues</a>{" "}
        for everything else.
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
        note: "the system is open source. read it before you run it. then run it.",
      }}
    >
      <header className="sub-hero">
        <div className="hero-annot mono" aria-hidden>
          <span>MOGPLEX</span>
          <span className="annot-rule" />
          <span>SHEET 05 — COMPANY</span>
        </div>
        <h1 className="sub-title">
          The company behind the <em className="grad">system</em>.
        </h1>
        <p className="sub-lede">
          Mogplex Inc. builds an open-source system that builds and maintains
          software. Intent goes in: GitHub events, schedules, and Slack asks.
          Reviewed, running code comes out through agents that your policies
          control. It is not a coding assistant or a CI add-on. It is the full
          pipeline from plan to deploy, visible at every station. It still
          works after the feature ships.
        </p>
        <p className="mono micro">
          MOGPLEX INC. · OPEN SOURCE · GENERALLY AVAILABLE
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
