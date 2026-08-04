import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "FAQ — Mogplex",
  description:
    "What Mogplex runs, what it costs, where your code executes, and what an agent can and can't ship without you. The questions skeptical engineers ask before wiring agents into their repos.",
  path: "/faq",
});

type Faq = {
  q: string;
  // Plain-text answer — also serialized into the FAQPage JSON-LD.
  a: string;
  // Optional rich rendering (links, emphasis) shown in place of `a` on the page.
  aRich?: ReactNode;
};

const FAQS: Faq[] = [
  {
    q: "What is Mogplex, in one sentence?",
    a: "The open-source agentic software factory: intent goes in — GitHub events, schedules, Slack asks — and agents plan, build, review, and ship it through one inspectable pipeline, so what comes out the other side is reviewed, running code.",
  },
  {
    q: "Which agents does it run?",
    a: "Claude Code and Codex today, with your MCP tools available inside every run. You pick the agent and model per pipeline; Mogplex provides the model access, so there are no API keys to set up. Prefer your own model billing? Add your own AI Gateway key in Settings → API Keys and your runs use it instead.",
  },
  {
    q: "Can an agent merge to main without a human?",
    a: "Only if you configure a pipeline that way — and even then your branch protections still rule. Mogplex cannot bypass required reviews, required checks, or protected branches. Most teams start with draft-PR-only gates and loosen from there.",
  },
  {
    q: "Where does the code actually execute?",
    a: "In a fresh microVM per run — a Vercel Sandbox holding a clone of your repo. Nothing is shared between runs, nothing runs on your machines, and the sandbox is destroyed when the run ends.",
  },
  {
    q: "What does it cost?",
    a: "Nothing, during the private beta — model usage and sandbox compute are covered for approved teams while we finalize pricing. You'll know what Mogplex costs before anything changes for your team.",
  },
  {
    q: "What can trigger a run?",
    a: "GitHub events (issues, PRs, pushes, labels), CI failures, schedules, Slack mentions, and standing assignments — recurring jobs you define once, like “keep the docs matching the API.”",
  },
  {
    q: "Can I see what an agent did — or stop it?",
    a: "Every run is inspectable call-by-call: each model call and tool call, metered and logged. You can step into a live run to approve the next tool call, redirect the plan, or kill it from the web app or CLI.",
  },
  {
    q: "How is this different from assigning tasks to an AI teammate?",
    a: "Delegation is a transaction: you ask, it answers, and when you stop asking, everything stops. A pipeline is infrastructure: you wire it once and work keeps flowing through it — while you sleep, while you build something else.",
  },
  {
    q: "Is it open source?",
    a: "The CLI is Apache-2.0-licensed and the source is on GitHub at github.com/Mogplex/cli, so you can read exactly what authenticates against your repositories before running it.",
    aRich: (
      <>
        The CLI is Apache-2.0-licensed and the source is on GitHub at{" "}
        <a href="https://github.com/Mogplex/cli">
          github.com/Mogplex/cli
        </a>
        , so you can read exactly what authenticates against your repositories
        before running it.
      </>
    ),
  },
  {
    q: "How do I get access?",
    a: "Mogplex is in private beta and approving teams in batches. Request an access code, tell us how you'd use it, and we'll get you in as capacity opens up.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

export default function FaqPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "SHEET 04 — END",
        lines: ["Still skeptical?", "Good. Bring that."],
        note: "the best beta feedback comes from people who don't trust us yet.",
      }}
    >
      <header className="sub-hero">
        <div className="hero-annot mono" aria-hidden>
          <span>MOGPLEX</span>
          <span className="annot-rule" />
          <span>SHEET 04 — FAIR QUESTIONS</span>
        </div>
        <h1 className="sub-title">
          Fair <em className="grad">questions</em>.
        </h1>
        <p className="sub-lede">
          The ten things skeptical engineers ask before wiring an agent into their repo.
          Short answers here; the long ones live in the{" "}
          <a href="https://docs.mogplex.com">docs</a> and in{" "}
          <Link href="/how-it-works">the anatomy of a run</Link>.
        </p>
      </header>

      <section className="faq-list" aria-label="Frequently asked questions">
        {FAQS.map((f, i) => (
          <article className="faq-item" key={f.q}>
            <p className="faq-idx mono" aria-hidden>
              Q·{String(i + 1).padStart(2, "0")}
            </p>
            <div>
              <h2 className="faq-q">{f.q}</h2>
              <p className="faq-a">{f.aRich ?? f.a}</p>
            </div>
          </article>
        ))}
      </section>

      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
    </MarketingSubpageShell>
  );
}
