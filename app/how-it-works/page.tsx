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
  t: string;
  num: string;
  name: string;
  desc: string;
  fact: string;
};

const STAGES: Stage[] = [
  {
    t: "T+00:00.0",
    num: "00",
    name: "An event arrives",
    desc: "An issue opens. CI fails. A schedule fires. Someone asks in Slack. A standing assignment comes due. Mogplex catches the event, dedupes it, and assembles the context that matters: the repo, the thread, the logs, the diff.",
    fact: "held — one event, one run. Nothing polls your repo. Nothing runs on your machines.",
  },
  {
    t: "T+00:00.8",
    num: "01",
    name: "A run is queued",
    desc: "The pipeline you wired decides everything up front: which repo, which harness (Mogplex native, Claude Code, or Codex), what context it gets, and which gates its output must pass. The system records that decision before any work starts.",
    fact: "held — every run traces back to the exact event that caused it.",
  },
  {
    t: "T+00:04.2",
    num: "02",
    name: "A sandbox boots",
    desc: "A fresh microVM boots with a clone of your repo. Nothing is shared between runs. Hosted sandbox time uses your hosted usage balance at the published per-minute rate.",
    fact: "held — per-run isolation. Your code never executes on shared infrastructure you can't see.",
  },
  {
    t: "T+00:06.5",
    num: "03",
    name: "The agent loop",
    desc: "The agent writes code, runs your tests, and calls your MCP tools. It iterates until the tests pass or its budget stops it. Mogplex gives you model access. The system meters and logs every model call and tool call.",
    fact: "held — open any live run call-by-call. Approve the next tool call, redirect the plan, or kill it.",
  },
  {
    t: "T+04:12.9",
    num: "04",
    name: "The gates",
    desc: "Output leaves the sandbox only one way: as a PR, a check run, or a merge that passed the gates you configured. Branch protections always rule. Mogplex cannot bypass required reviews, required checks, or protected branches.",
    fact: "held — nothing ships that your rules wouldn't let a human ship.",
  },
  {
    t: "T+04:40.1",
    num: "05",
    name: "Reconcile, then loop",
    desc: "When the change deploys, the deploy points back to the run. The run points back to the event. The audit trail shows what asked for the work, what did it, what it cost, and who approved it. Then the pipeline loops back to the trigger. The same system that built the change now maintains it.",
    fact: "held — “who did this and why” always has an answer.",
  },
];

export default function HowItWorksPage() {
  return (
    <MarketingSubpageShell
      close={{
        kicker: "SHEET 03 — END",
        lines: ["Watch one run.", "You'll wire five."],
        note: "Individual plans show all three limits. company plans use custom terms.",
      }}
    >
      <header className="sub-hero">
        <div className="hero-annot mono" aria-hidden>
          <span>MOGPLEX</span>
          <span className="annot-rule" />
          <span>SHEET 03 — ANATOMY OF A RUN</span>
        </div>
        <h1 className="sub-title">
          One run, <em className="grad">drawn to scale</em>.
        </h1>
        <p className="sub-lede">
          You wouldn&apos;t trust a deploy pipeline you couldn&apos;t inspect. Same
          rule here. This is the full path of a single run, from the event that
          wakes it to the deploy that closes the loop. It also shows what holds
          at every station. Wire it once. The loop runs for new features and
          last night&apos;s dependency rot.
        </p>
        <p className="mono micro">
          timestamps from a representative nightly-deps run · your repo · your gates
        </p>
      </header>

      <section className="runsheet" aria-label="Stages of a run">
        {STAGES.map((s) => (
          <article className="stage" key={s.num}>
            <span className="node" aria-hidden />
            <div>
              <p className="stage-t mono">
                <b>{s.t}</b> · STATION {s.num}
              </p>
              <h2 className="stage-name">{s.name}</h2>
            </div>
            <div>
              <p className="stage-desc">{s.desc}</p>
              <p className="stage-fact mono">▪ {s.fact}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="terms" aria-label="What stays yours">
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
              Every run gets a fresh, isolated microVM. Nothing is shared
              between runs.
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

        <div className="shipped">
          <span className="node node-end" aria-hidden />
          <p className="mono shipped-label">
            <b>RECONCILED.</b> &nbsp;the deploy points back at the run &nbsp;↺
          </p>
        </div>
      </section>
    </MarketingSubpageShell>
  );
}
