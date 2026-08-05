import type { Metadata } from "next";
import { Fragment } from "react";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Workflow patterns — Mogplex",
  description:
    "Eight pipelines teams wire in their first week: nightly dependency bumps, CI first response, issue-to-PR, PR review, docs drift, and more. Most maintain software you already shipped. Every one ends at your gates.",
  path: "/workflows",
});

type Pattern = {
  num: string;
  slug: string;
  name: string;
  kind: "BUILD" | "MAINTAIN";
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
    kind: "MAINTAIN",
    chips: ["cron · 02:00 UTC", "sandbox", "PR"],
    flow: ["cron fires", "bump + audit", "your test suite", "PR · you merge"],
    desc: "Runs while you sleep. It bumps dependencies one ecosystem at a time and runs your test suite against the result. The PR shows what moved, why, and the upstream changelogs. If tests go red, it narrows the bump or reports what broke. It does not ship noise.",
    gate: "PR requires your review. The merge is yours.",
  },
  {
    num: "P·02",
    slug: "ci-first-responder",
    name: "CI first responder",
    kind: "MAINTAIN",
    chips: ["trigger · main goes red", "sandbox", "PR or revert"],
    flow: ["check run fails", "reproduce in sandbox", "bisect + fix", "PR + diagnosis"],
    desc: "When main goes red, a run boots with the failing job's logs. It reproduces the failure, bisects the offending change, and opens a fix PR or a revert. The run includes a written diagnosis. You arrive to an explanation, not a red wall.",
    gate: "Fixes ship as PRs. Auto-revert only if you turn it on.",
  },
  {
    num: "P·03",
    slug: "issue-to-pr",
    name: "Issue to draft PR",
    kind: "BUILD",
    chips: ["trigger · label agent:take", "plan first", "draft PR"],
    flow: ["issue labeled", "plan posted as comment", "build + tests", "draft PR closes issue"],
    desc: "Add the agent:take label and the pipeline picks up the issue. It posts its plan as a comment, builds in a sandbox, and opens a draft PR that closes the issue. The PR carries the plan, the diff, and the test run. Disagree with the plan? Reply on the issue. The run reads it.",
    gate: "Draft PRs only. Nothing merges without a human.",
  },
  {
    num: "P·04",
    slug: "pr-review-sidekick",
    name: "PR review sidekick",
    kind: "MAINTAIN",
    chips: ["trigger · PR opened", "review comments", "check run"],
    flow: ["PR ready", "read diff + context", "findings as inline review", "risk check run"],
    desc: "Every PR gets a first pass before a human spends attention on it. The run posts correctness findings as inline comments. A check run summarizes risk. It reviews. It never approves. Approval stays human.",
    gate: "Comment-only. It cannot approve or merge.",
  },
  {
    num: "P·05",
    slug: "slack-lane",
    name: "The Slack lane",
    kind: "BUILD",
    chips: ["trigger · slack mention", "thread context", "PR"],
    flow: ["“fix the flaky e2e”", "run boots with thread context", "PR link lands in thread"],
    desc: "Small asks stop dying in the backlog. Mention the pipeline in a thread and the ask stays where you made it. The thread gets the run link, progress updates, and the PR.",
    gate: "Same gates as any other run. Slack grants no shortcuts.",
  },
  {
    num: "P·06",
    slug: "docs-drift",
    name: "Docs drift watcher",
    kind: "MAINTAIN",
    chips: ["standing assignment", "trigger · merge touches api/", "docs PR"],
    flow: ["merge touches api/", "diff reality vs docs", "docs PR"],
    desc: "Name the surfaces that must stay documented. When a merge changes one, a run compares the code with the docs. It opens a docs PR for the drift. You set this standing assignment once. You never re-ask.",
    gate: "Docs PRs reviewed like any other change.",
  },
  {
    num: "P·07",
    slug: "test-backfill",
    name: "Test backfill, one PR a night",
    kind: "MAINTAIN",
    chips: ["standing assignment", "cron · nightly", "small PR"],
    flow: ["nightly", "pick least-covered hot file", "write + verify tests", "one small PR"],
    desc: "Each night it finds the least-covered file that changed recently and writes tests for it. It makes sure that each test covers real behavior. It discards a test that cannot fail. One small PR per night keeps the review load sane.",
    gate: "One PR per night, sized for a five-minute review.",
  },
  {
    num: "P·08",
    slug: "release-notes",
    name: "Release notes writer",
    kind: "BUILD",
    chips: ["trigger · tag pushed", "reads merged PRs", "notes PR"],
    flow: ["v1.4.0 tagged", "read PRs since last tag", "notes in your voice", "PR to the draft"],
    desc: "It reads every PR and linked issue merged since the last tag. It writes the notes in your changelog's voice. The run sends a PR to the release draft. The release goes out when you say so.",
    gate: "You publish the release. The run only drafts it.",
  },
];

export default function WorkflowsPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "SHEET 02 — END",
        lines: ["Wire one.", "Steal the rest."],
        note: "no monthly fee on payg. no sales call, no hidden rates.",
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
          Eight patterns teams wire in their first week. Each one starts from a
          real trigger and does the work in a per-run sandbox. Each one ends as
          a PR behind your gates. Copy the wire command. Then change the
          trigger, the agent, and the gates until it fits.
        </p>
        <p className="mono micro">
          8 patterns · 5 maintain code you already shipped · autonomy is a dial,
          not a default
        </p>
      </header>

      <section className="patterns" aria-label="Workflow patterns">
        {PATTERNS.map((p) => (
          <article className="pattern" key={p.slug} id={p.slug}>
            <span className="node" aria-hidden />
            <div>
              <p className="pattern-num">
                <span aria-hidden>{p.num} — </span>
                {p.kind}
              </p>
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
