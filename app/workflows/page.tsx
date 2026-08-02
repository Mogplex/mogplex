import type { Metadata } from "next";
import { Fragment } from "react";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Workflow patterns — Mogplex",
  description:
    "Eight agentic CI/CD pipelines teams wire in their first week: nightly dependency bumps, CI first response, issue-to-PR, PR review, docs drift, and more. Every one ships through your gates.",
  path: "/workflows",
});

type Pattern = {
  num: string;
  slug: string;
  name: string;
  chips: string[];
  flow: string[];
  desc: string;
  gate: string;
};

const PATTERNS: Pattern[] = [
  {
    num: "P·01",
    slug: "nightly-deps",
    name: "Nightly dependency bumps",
    chips: ["cron · 02:00 UTC", "sandbox", "PR"],
    flow: ["cron fires", "bump + audit", "your test suite", "PR · you merge"],
    desc: "Wakes while you sleep, bumps dependencies one ecosystem at a time, and runs your test suite against the result. The PR includes what moved, why, and the upstream changelogs. If tests go red, it narrows the bump or reports what broke instead of shipping noise.",
    gate: "PR requires your review. The merge is yours.",
  },
  {
    num: "P·02",
    slug: "ci-first-responder",
    name: "CI first responder",
    chips: ["trigger · main goes red", "sandbox", "PR or revert"],
    flow: ["check run fails", "reproduce in sandbox", "bisect + fix", "PR + diagnosis"],
    desc: "When main goes red, a run boots with the failing job's logs, reproduces the failure, bisects to the offending change, and opens either a fix PR or a revert — with a written diagnosis. You arrive to an explanation, not a red wall.",
    gate: "Fixes ship as PRs. Auto-revert only if you turn it on.",
  },
  {
    num: "P·03",
    slug: "issue-to-pr",
    name: "Issue to draft PR",
    chips: ["trigger · label agent:take", "plan first", "draft PR"],
    flow: ["issue labeled", "plan posted as comment", "build + tests", "draft PR closes issue"],
    desc: "Label an issue and the pipeline picks it up: it posts its plan as a comment, builds in a sandbox, and opens a draft PR that closes the issue — plan, diff, and test run attached. Disagree with the plan? Reply on the issue; the run reads it.",
    gate: "Draft PRs only. Nothing merges without a human.",
  },
  {
    num: "P·04",
    slug: "pr-review-sidekick",
    name: "PR review sidekick",
    chips: ["trigger · PR opened", "review comments", "check run"],
    flow: ["PR ready", "read diff + context", "findings as inline review", "risk check run"],
    desc: "Every PR gets a first pass before a human spends attention on it: correctness findings as inline review comments and a check run that summarizes risk. It reviews; it never approves. Approval stays human.",
    gate: "Comment-only. It cannot approve or merge.",
  },
  {
    num: "P·05",
    slug: "slack-lane",
    name: "The Slack lane",
    chips: ["trigger · slack mention", "thread context", "PR"],
    flow: ["“fix the flaky e2e”", "run boots with thread context", "PR link lands in thread"],
    desc: "Small asks stop dying in the backlog. Mention the pipeline in a thread and the ask stays where it was made: the thread gets the run link, progress as it happens, and the PR when it's up.",
    gate: "Same gates as any other run — Slack grants no shortcuts.",
  },
  {
    num: "P·06",
    slug: "docs-drift",
    name: "Docs drift watcher",
    chips: ["standing assignment", "trigger · merge touches api/", "docs PR"],
    flow: ["merge touches api/", "diff reality vs docs", "docs PR"],
    desc: "Name the surfaces that must stay documented. When a merge changes one, a run diffs what the code now does against what the docs still say and opens a docs PR for the drift. Standing assignment — you never re-ask.",
    gate: "Docs PRs reviewed like any other change.",
  },
  {
    num: "P·07",
    slug: "test-backfill",
    name: "Test backfill, one PR a night",
    chips: ["standing assignment", "cron · nightly", "small PR"],
    flow: ["nightly", "pick least-covered hot file", "write + verify tests", "one small PR"],
    desc: "Each night: find the least-covered file that changed recently, write tests for it, and verify they actually exercise behavior — a test that can't fail is discarded, not shipped. Capped at one small PR per night so review load stays sane.",
    gate: "One PR per night, sized for a five-minute review.",
  },
  {
    num: "P·08",
    slug: "release-notes",
    name: "Release notes writer",
    chips: ["trigger · tag pushed", "reads merged PRs", "notes PR"],
    flow: ["v1.4.0 tagged", "read PRs since last tag", "notes in your voice", "PR to the draft"],
    desc: "Reads every PR and linked issue merged since the last tag, writes the notes in your changelog's existing voice, and ships them as a PR against the release draft. The release goes out when you say so.",
    gate: "You publish the release; it only drafts.",
  },
];

export default function WorkflowsPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "SHEET 02 — END",
        lines: ["Wire one.", "Steal the rest."],
        note: "private beta, approving in batches. free while we learn what you need.",
      }}
    >
      <header className="sub-hero">
        <div className="hero-annot mono" aria-hidden>
          <span>MOGPLEX</span>
          <span className="annot-rule" />
          <span>SHEET 02 — WORKFLOW PATTERNS</span>
        </div>
        <h1 className="sub-title">
          Pipelines worth <em className="grad">stealing</em>.
        </h1>
        <p className="sub-lede">
          Eight patterns teams wire in their first week. Each one starts from a real trigger,
          does the work in a per-run sandbox, and ends as <strong>a PR behind your gates</strong>.
          Copy the wire command, then adjust the trigger, the agent, and the gates until it fits.
        </p>
        <p className="mono micro">
          8 patterns · every one ends at your gates · autonomy is a dial, not a default
        </p>
      </header>

      <section className="patterns" aria-label="Workflow patterns">
        {PATTERNS.map((p) => (
          <article className="pattern" key={p.slug} id={p.slug}>
            <span className="node" aria-hidden />
            <div>
              <p className="pattern-num" aria-hidden>{p.num}</p>
              <h2 className="pattern-name">{p.name}</h2>
              <ul className="pattern-chips mono">
                {p.chips.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="flowline mono">
                {p.flow.map((step, i) => (
                  <Fragment key={step}>
                    {i > 0 ? <i aria-hidden>──▶</i> : null}
                    {step}
                  </Fragment>
                ))}
              </p>
              <p className="pattern-desc">{p.desc}</p>
              <p className="pattern-gate mono">
                ▪ gate — <b>{p.gate}</b>
              </p>
              <p className="install mono">
                <span className="t-dim">$</span> mogplex wire {p.slug}
              </p>
            </div>
          </article>
        ))}
      </section>
    </MarketingSubpageShell>
  );
}
