"use client";

import {
  AccentPeriod,
  ArrowRight,
  Eyebrow,
  GITHUB_URL,
} from "@/components/marketing/mpx-chrome";

import { LiveRunMockup } from "./live-run-mockup";

export function HeroSection() {
  return (
    <section className="mpx-hero" data-testid="landing-hero">
      <div className="mpx-hero-copy">
        <div className="mpx-rise" style={{ animationDelay: ".05s" }}>
          <Eyebrow large>
            APACHE-2.0 · SELF-HOSTABLE · GENERALLY AVAILABLE
          </Eyebrow>
        </div>
        <h1 className="mpx-rise" style={{ animationDelay: ".14s" }}>
          The open-source engine
          <br className="mpx-lg-break" /> for building and
          <br className="mpx-lg-break" /> maintaining software
          <AccentPeriod />
        </h1>
        <p className="mpx-rise" style={{ animationDelay: ".24s" }}>
          Events go in: issues, CI failures, schedules, and Slack asks.
          Agents plan, build, test, and review in per-run sandboxes. PRs
          come out behind your gates.
        </p>
        <div
          className="mpx-hero-actions mpx-rise"
          style={{ animationDelay: ".34s" }}
        >
          <a
            className="mpx-button is-primary"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="landing-primary-cta"
          >
            Read the code
          </a>
          <a className="mpx-text-link" href="#run">
            Watch one run
            <ArrowRight className="mpx-arrow" />
          </a>
        </div>
        <div
          className="mpx-hero-stamps mpx-rise"
          style={{ animationDelay: ".44s" }}
        >
          <p className="is-rule">—</p>
          <p>
            <span aria-hidden>+</span>&nbsp;&nbsp;MOGPLEX SYSTEMS
          </p>
          <p>
            <span aria-hidden>+</span>&nbsp;&nbsp;INTENT → REVIEWED →
            RUNNING CODE
          </p>
          <p>
            <span aria-hidden>+</span>&nbsp;&nbsp;WIRED. WATCHED. GATED.
          </p>
        </div>
      </div>
      <div
        id="run"
        className="mpx-hero-run mpx-rise"
        style={{ animationDelay: ".2s" }}
      >
        <LiveRunMockup />
      </div>
    </section>
  );
}
