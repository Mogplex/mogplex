"use client";

import Link from "next/link";

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
            APACHE-2.0 · SELF-HOSTABLE · NO SALES CALL
          </Eyebrow>
        </div>
        <h1 className="mpx-rise" style={{ animationDelay: ".14s" }}>
          The open-source
          <br className="mpx-lg-break" /> agent foundry
          <AccentPeriod />
        </h1>
        <p className="mpx-rise" style={{ animationDelay: ".24s" }}>
          Agents plan, build, test, and review your code. Each run is a
          sandbox you can watch, on a platform you can read. Your gates
          decide what ships.
        </p>
        <div
          className="mpx-hero-actions mpx-rise"
          style={{ animationDelay: ".34s" }}
        >
          <Link
            className="mpx-button is-primary"
            href="/signup"
            data-testid="landing-primary-cta"
          >
            Start now
          </Link>
          <a
            className="mpx-text-link"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            Read the code
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
            <span aria-hidden>+</span>&nbsp;&nbsp;NO SEAT FEES. NO SALES
            CALL.
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
