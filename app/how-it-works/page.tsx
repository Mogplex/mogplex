import type { Metadata } from "next";
import { MarketingSubpageShell } from "@/components/marketing/subpage-shell";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "How Mogplex works — anatomy of a run",
  description:
    "From trigger to merged PR: how a Mogplex run catches an event, boots a per-run sandbox, does the work with your chosen agent, and ships through the gates you set.",
  path: "/how-it-works",
});

type Stage = {
  num: string;
  id: string;
  label: string;
  name: string;
  desc: string;
  control: string;
  fact: string;
};

const STAGES: Stage[] = [
  {
    num: "01",
    id: "event",
    label: "Trigger",
    name: "An event arrives",
    desc: "An issue opens, CI fails, or a schedule fires. Mogplex collects the repo, thread, logs, and diff that the agent needs to act.",
    control: "You choose the trigger",
    fact: "Connect an event, a Slack message, or a schedule to the pipeline you want to run.",
  },
  {
    num: "02",
    id: "pipeline",
    label: "Plan",
    name: "Your pipeline sets the plan",
    desc: "Your pipeline defines the repo, agent, context, and approval gates before work starts. Each run records the event that caused it.",
    control: "Your agent, your context",
    fact: "Choose Mogplex Native, Claude Code, or Codex for each pipeline. Add the tools and context it needs.",
  },
  {
    num: "03",
    id: "sandbox",
    label: "Isolate",
    name: "A sandbox boots",
    desc: "The run gets an isolated microVM with a clone of your repo. The agent can change files and run commands there. Your machine stays free.",
    control: "A separate place to work",
    fact: "Each run has its own sandbox. Hosted sandbox time draws from your usage balance.",
  },
  {
    num: "04",
    id: "agent",
    label: "Build",
    name: "The agent loop",
    desc: "The agent writes code, runs tests, and uses your connected tools. Follow the work as it happens, with each model call and tool result in view.",
    control: "Stay in control",
    fact: "Inspect a live run, approve a tool call, redirect the plan, or stop the work.",
  },
  {
    num: "05",
    id: "gates",
    label: "Review",
    name: "The gates",
    desc: "The work reaches a pull request and the checks you set. A merge must pass your configured gates. Branch protections and required reviews still apply.",
    control: "Your rules decide what ships",
    fact: "Set the level of autonomy per pipeline. Required checks and reviews still apply.",
  },
  {
    num: "06",
    id: "trace",
    label: "Trace",
    name: "Reconcile, then loop",
    desc: "Trace a deployed change back to its run and the event that started it. The pipeline stays ready for the next feature, failed check, or maintenance task.",
    control: "Keep the full history",
    fact: "See what requested the work, which agent did it, what it cost, and who approved it.",
  },
];

export default function HowItWorksPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "YOUR FIRST PIPELINE",
        lines: ["Set the rules.", "Let the work run."],
        note: "Choose a repo, an agent, and the gates every change must pass.",
      }}
    >
      <div className="run-guide">
        <header className="sub-hero">
          <p className="run-kicker mono">HOW IT WORKS</p>
          <h1 className="sub-title">
            From the first event<br />
            to code you can trust<span className="run-period">.</span>
          </h1>
          <p className="sub-lede">
            You choose the agent and set the rules. Mogplex takes each run from
            trigger to review in an isolated sandbox, with the work visible at
            every step.
          </p>
        </header>

        <nav className="run-overview" aria-label="Run overview">
          <ol>
            {STAGES.map((stage) => (
              <li key={stage.id}>
                <a href={`#run-${stage.id}`}>
                  <span className="mono">{stage.num}</span>
                  <strong>{stage.label}</strong>
                  <span className="run-arrow" aria-hidden>↗</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <section className="runsheet" aria-label="Stages of a run">
          {STAGES.map((s) => (
            <article className="stage" id={`run-${s.id}`} key={s.id}>
              <span className="stage-num mono" aria-hidden>{s.num}</span>
              <div className="stage-body">
                <h2 className="stage-name">{s.name}</h2>
                <p className="stage-desc">{s.desc}</p>
              </div>
              <div className="stage-control">
                <h3>{s.control}</h3>
                <p className="stage-fact">{s.fact}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="terms" aria-label="What stays yours">
          <h2 className="terms-title">Your code. Your rules.</h2>
          <div className="terms-row">
            <div className="term">
              <p className="term-k mono">HARNESSES</p>
              <p className="term-v">
                The native Mogplex agent, Claude Code, and Codex. Pick the
                harness and model per pipeline. Every call is visible
                call-by-call.
              </p>
            </div>
            <div className="term">
              <p className="term-k mono">SANDBOX</p>
              <p className="term-v">
                Every run gets a fresh, isolated microVM with a separate
                workspace.
              </p>
            </div>
            <div className="term">
              <p className="term-k mono">GATES</p>
              <p className="term-v">
                Branch protections, required checks, and required reviews always
                win. Autonomy is a dial you set per pipeline.
              </p>
            </div>
            <div className="term">
              <p className="term-k mono">SOURCE</p>
              <p className="term-v">
                The <a href="https://github.com/mogplex/mogplex">platform</a> is
                Apache-2.0. Read what authenticates against your repos before you
                run it.
              </p>
            </div>
          </div>
        </section>
      </div>
    </MarketingSubpageShell>
  );
}
