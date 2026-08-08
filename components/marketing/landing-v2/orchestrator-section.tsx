"use client";

import Link from "next/link";

import {
  AccentPeriod,
  ArrowRight,
  Eyebrow,
} from "@/components/marketing/mpx-chrome";

export function OrchestratorSection() {
  return (
    <section id="orchestrator" className="mpx-capabilities">
      <div className="mpx-section-intro">
        <div>
          <Eyebrow large>ORCHESTRATOR</Eyebrow>
          <h2>
            Command every project
            <br />
            from one control surface
            <AccentPeriod />
          </h2>
        </div>
        <div>
          <p>
            The orchestrator is one control surface across all of your
            projects. Say what you want. It routes the work, spawns the
            agents, and reports back with PRs.
          </p>
          <Link className="mpx-text-link is-semibold" href="/how-it-works">
            How the orchestrator works
            <ArrowRight className="mpx-arrow" />
          </Link>
        </div>
      </div>

      <div className="mpx-cap-grid">
        <article className="mpx-cap is-lead">
          <p className="mpx-cap-kicker">MULTI-PROJECT</p>
          <h3>
            Every repo answers to the same control surface
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            Ask for a change that spans three services. The orchestrator
            routes work to each project, tracks every run, and answers
            with links to the PRs.
          </p>
        </article>

        <article className="mpx-cap is-byok">
          <p className="mpx-cap-kicker">PARALLEL WORKTREES</p>
          <h3>
            Agents work side by side, not in line
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            Each agent runs in its own worktree. Ten tasks fan out at once
            and never collide. The work merges behind your gates.
          </p>
        </article>

        <article className="mpx-cap is-zdr is-wide">
          <p className="mpx-cap-kicker">SPEC-BASED BUILDS</p>
          <h3>
            Point it at a spec. Set a budget
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            Want a full system &mdash; an EHR, say? Write the spec, set a
            $25,000 cap, and let it run. You review the PRs while the cap
            holds the spend.
          </p>
          <div className="mpx-zdr-flow">
            <div>
              <small>01 / SPEC</small>
              <b>Write what you want</b>
              <span>The orchestrator plans the pipelines</span>
            </div>
            <div>
              <small>02 / FAN OUT</small>
              <b>Agents in parallel</b>
              <span>One worktree per agent</span>
            </div>
            <div>
              <small>03 / BUDGET</small>
              <b>A hard spend cap</b>
              <span>Runs stop at your limit</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
