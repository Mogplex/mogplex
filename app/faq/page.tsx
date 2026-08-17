import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "FAQ — Mogplex",
  description:
    "What Mogplex runs, what it costs, where your code runs, and what an agent can and can't ship without you. The questions skeptical engineers ask before they wire agents into their repos.",
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
    a: "A system that builds and maintains software. Events go in: GitHub events, schedules, and Slack asks. Agents plan, build, test, and review the work in sandboxes. Reviewed, running code comes out through your gates.",
  },
  {
    q: "Which agents does it run?",
    a: "The native Mogplex agent, Claude Code, and Codex, with your MCP tools available inside every run. You pick the harness and model per pipeline. Hosted model access uses your Mogplex balance, so you do not need to set up API keys. Prefer your own model billing? Add your AI Gateway key in Settings → API Keys. Your runs then use it.",
  },
  {
    q: "Can an agent merge to main without a human?",
    a: "Only if you configure a pipeline that way. Your branch protections still rule. Mogplex cannot bypass required reviews, required checks, or protected branches. Most teams start with draft-PR-only gates and loosen from there.",
  },
  {
    q: "Where does the code run?",
    a: "In a fresh microVM for each run: a Vercel Sandbox that holds a clone of your repo. Runs share nothing. Nothing runs on your machines.",
  },
  {
    q: "What does it cost?",
    a: "Individual plans start with Pro at $20 a month. Each plan includes Concurrency, retained data, and hosted usage. You can buy more capacity without changing plans. Business and Enterprise plans use custom terms.",
  },
  {
    q: "What can trigger a run?",
    a: "GitHub events can start a run: issues, comments, mentions, pushes, pull requests, CI failures, labels, and tag pushes. Schedules, Slack mentions, signed webhooks, and standing assignments can also start runs.",
  },
  {
    q: "Can I see what an agent did — or stop it?",
    a: "Every run is visible call-by-call. The system meters and logs each model call and tool call. You can enter a live run to approve the next tool call, redirect the plan, or stop it from the web app or CLI.",
  },
  {
    q: "How is this different from assigning tasks to an AI teammate?",
    a: "Delegation is a transaction: you ask, it answers, and when you stop asking, everything stops. A pipeline is infrastructure. You wire it once. Work continues while you sleep or build something else.",
  },
  {
    q: 'What does "maintains" mean, concretely?',
    a: "It is the work nobody staffs. A run bumps your dependencies each night and tests the result. Another run reproduces and bisects CI failures. Other runs open docs PRs when your API drifts, backfill tests, or draft release notes. You wire each pipeline once.",
  },
  {
    q: "Is it open source?",
    a: "Yes. The platform at github.com/mogplex/mogplex is Apache-2.0. You can read what authenticates against your repositories before you run it. You can also self-host it.",
    aRich: (
      <>
        Yes. The platform at{" "}
        <a href="https://github.com/mogplex/mogplex">
          github.com/mogplex/mogplex
        </a>{" "}
        is Apache-2.0. You can read what authenticates against your repositories
        before you run it. You can also self-host it.
      </>
    ),
  },
  {
    q: "How do I start?",
    a: "Choose an Individual plan, create your account, and connect a repo. Your plan shows the capacity available before you wire a pipeline. You can also self-host the Apache-2.0 application with no license fee.",
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
        note: "the best feedback comes from people who don't trust us yet.",
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
          The 11 things skeptical engineers ask before they wire an agent into
          their repo. Short answers live here. The long answers live in the{" "}
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
