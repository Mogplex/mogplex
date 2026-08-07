"use client";

import Link from "next/link";

import {
  AccentPeriod,
  ArrowRight,
  Eyebrow,
} from "@/components/marketing/mpx-chrome";

import { traceRows } from "./data";

export function BuildMaintainSection() {
  return (
    <section id="build-maintain" className="mpx-capabilities">
      <div className="mpx-section-intro">
        <div>
          <Eyebrow large>BUILD AND MAINTAIN</Eyebrow>
          <h2>
            Shipping is half the job
            <AccentPeriod />
          </h2>
        </div>
        <div>
          <p>
            Software rots the day it ships. Dependencies age, CI breaks,
            docs drift, and coverage decays. Mogplex runs pipelines against
            both halves of the job.
          </p>
          <Link className="mpx-text-link is-semibold" href="/workflows">
            All 8 starter pipelines
            <ArrowRight className="mpx-arrow" />
          </Link>
        </div>
      </div>

      <div className="mpx-cap-grid is-duo">
        <article className="mpx-cap is-zdr">
          <p className="mpx-cap-kicker">BUILD</p>
          <h3>
            PRs that ship safely to production, with guardrails you set
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            Label an issue. A draft PR comes back with the plan, the diff,
            and the test run. Ask in Slack, and the PR link lands in the
            same thread.
          </p>
        </article>
        <article className="mpx-cap is-byok">
          <p className="mpx-cap-kicker">MAINTAIN</p>
          <h3>
            Wake up to fixes, not a red wall
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            A run can test dependency bumps each night, diagnose a failed
            CI job, or open a docs PR when your API changes. You wire each
            pipeline once.
          </p>
        </article>
      </div>
    </section>
  );
}

export function GatesSection() {
  return (
    <section id="capabilities" className="mpx-capabilities">
      <div className="mpx-section-intro">
        <div>
          <Eyebrow large>YOUR GATES HOLD</Eyebrow>
          <h2>
            Autonomy is a dial.
            <br />
            You set it per pipeline
            <AccentPeriod />
          </h2>
        </div>
        <div>
          <p>
            Every run ends at your branch protections, required checks,
            and required reviews. Mogplex cannot bypass them. The code
            that enforces your gates is open, so read it before you
            trust it.
          </p>
          <Link className="mpx-text-link is-semibold" href="/how-it-works">
            Follow one run
            <ArrowRight className="mpx-arrow" />
          </Link>
        </div>
      </div>

      <div className="mpx-cap-grid">
        <article className="mpx-cap is-zdr">
          <i className="mpx-orbit is-near" aria-hidden />
          <i className="mpx-orbit is-far" aria-hidden />
          <div className="mpx-cap-top">
            <span className="mpx-cap-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 3 4.5 6v5.5c0 4.4 3.1 7.7 7.5 9.5 4.4-1.8 7.5-5.1 7.5-9.5V6L12 3Z" />
                <path d="M8 12h8M12 8v8" />
              </svg>
            </span>
            <span className="mpx-default-pill">FRESH PER RUN</span>
          </div>
          <p className="mpx-cap-kicker">PER-RUN ISOLATION</p>
          <h3>
            Every run gets a fresh microVM
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            It holds a clone of your repo. Runs share nothing, and every
            run starts clean.
          </p>
          <div className="mpx-zdr-flow">
            <div>
              <small>01 / BOOT</small>
              <b>Fresh sandbox</b>
              <span>One run only</span>
            </div>
            <div>
              <small>02 / EXECUTION</small>
              <b>Scoped workspace</b>
              <span>Repo clone and tools</span>
            </div>
            <div>
              <small>03 / STOP</small>
              <b>Sandbox ends</b>
              <span>Output through your gates</span>
            </div>
          </div>
        </article>

        <article className="mpx-cap is-byok">
          <div className="mpx-cap-top">
            <span className="mpx-cap-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="8" cy="15" r="4" />
                <path d="m11 12 8-8M15 4h4v4M5 18l-2 2" />
              </svg>
            </span>
            <span className="mpx-cap-stamp">YOUR CHOICE</span>
          </div>
          <p className="mpx-cap-kicker">BYOK / KEY ROUTING</p>
          <h3>
            Use hosted models or your own keys
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            Hosted model access uses your Mogplex balance, at published
            rates. Or route each call through your own Anthropic, OpenAI,
            OpenRouter, or AI Gateway key. Your vault stores it.
          </p>
          <div className="mpx-vault">
            <small>
              <i aria-hidden />
              VAULT://PLATFORM/PRODUCTION
            </small>
            {(["Anthropic", "OpenAI", "OpenRouter"] as const).map(
              (provider, index) => (
                <p key={provider}>
                  <span>{provider}</span>
                  <b className={index === 2 ? "is-available" : ""}>
                    {index === 2 ? "AVAILABLE" : "CONNECTED"}
                  </b>
                </p>
              )
            )}
          </div>
        </article>

        <article id="control-planes" className="mpx-cap is-observe">
          <div className="mpx-observe-copy">
            <span className="mpx-cap-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6Z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
            </span>
            <p className="mpx-cap-kicker">EVERY CALL, EVERY CENT</p>
            <h3>
              Trace every decision down to the dollar
              <AccentPeriod />
            </h3>
            <p className="mpx-cap-description">
              Open any run call-by-call: model calls, tool calls, diffs,
              approvals, tokens, and cost. Approve the next call, redirect
              the plan, or stop the run.
            </p>
            <div className="mpx-chips">
              <span>LIVE REPLAY</span>
              <span>COST ATTRIBUTION</span>
              <span>RUN CONTROLS</span>
            </div>
          </div>
          <div className="mpx-trace">
            <header>
              <span>TRACE / RUN 4821</span>
              <span className="is-complete">
                <i aria-hidden />
                COMPLETE
              </span>
            </header>
            <div className="mpx-trace-rows">
              {traceRows.map(({ label, time, offset, width, tone }) => (
                <p key={label}>
                  <span>{label}</span>
                  <span className="mpx-trace-track">
                    <i
                      className={tone}
                      style={{ marginLeft: offset, width }}
                    />
                  </span>
                  <time>{time}</time>
                </p>
              ))}
            </div>
            <div className="mpx-stats">
              <p>
                <small>TOKENS</small>
                <b>84.2k</b>
              </p>
              <p>
                <small>COST</small>
                <b>$2.18</b>
              </p>
              <p>
                <small>TOOLS</small>
                <b>37</b>
              </p>
            </div>
          </div>
        </article>

        <article className="mpx-cap is-sandbox">
          <span className="mpx-cap-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3.5" y="5" width="17" height="14" rx="2" />
              <path d="m7 10 2.5 2.5L7 15M13 15h4" />
            </svg>
          </span>
          <p className="mpx-cap-kicker">RUN POLICIES</p>
          <h3>
            Your gates hold at every step
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            Network, filesystem, secret, and runtime policies apply to each
            run. Your repository rules still decide what can ship.
          </p>
          <div className="mpx-policy">
            <p>
              <span>Network egress</span>
              <b className="is-amber">ALLOWLIST</b>
            </p>
            <p>
              <span>Filesystem</span>
              <b className="is-neutral">WORKSPACE ONLY</b>
            </p>
            <p>
              <span>Secrets</span>
              <b className="is-green">SCOPED</b>
            </p>
            <p>
              <span>Max runtime</span>
              <b className="is-plain">30 MIN</b>
            </p>
          </div>
        </article>

        <article className="mpx-cap is-small-cap">
          <div className="mpx-harness-stack">
            <i>MCP</i>
            <i>API</i>
            <i>+</i>
          </div>
          <p className="mpx-cap-kicker">MCP CONNECTIONS</p>
          <h3>
            Your tools ride along
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            Connect MCP servers and REST APIs to a pipeline: Linear,
            Notion, Sentry, Supabase, Zapier, Browserbase, and your own.
          </p>
        </article>

        <article className="mpx-cap is-small-cap">
          <div className="mpx-cap-top">
            <span className="mpx-cap-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="9" cy="8" r="3" />
                <path d="M3.5 19c.6-3.3 2.7-5 5.5-5s4.9 1.7 5.5 5M16 7h5M18.5 4.5v5" />
              </svg>
            </span>
            <span className="mpx-cap-stamp">NO SEAT FEES</span>
          </div>
          <p className="mpx-cap-kicker">ROLES / BILLING</p>
          <h3>
            Four roles. One pooled balance
            <AccentPeriod />
          </h3>
          <p className="mpx-cap-description">
            Owner, admin, developer, viewer. Team usage stays in one
            prepaid balance, with the cost for each run and member.
          </p>
          <div className="mpx-models">
            <span>OWNER</span>
            <span>ADMIN</span>
            <span>DEVELOPER</span>
            <span>VIEWER</span>
          </div>
        </article>
      </div>
    </section>
  );
}
