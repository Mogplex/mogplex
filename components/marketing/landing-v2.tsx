"use client";

/* The page is the pipeline. Intents ride the spine from the hero
   inlet through Trigger / Integrate / Deploy and leave as merged PRs. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MogplexWordmark } from "@/components/brand/mogplex-wordmark";

import "./landing-v2.css";

const PR_START = 214;
const TERMINAL_CMD = "mogplex wire nightly-deps";
const SEP = " · ";
const MARQUEE_HALF =
  "YOUR REPO, ALWAYS MOVING ◆ TRIGGER → INTEGRATE → DEPLOY ◆ ".repeat(6);

function rideLabels(src: string, i: number) {
  return [
    src, // before trigger: raw intent
    "agent: building…", // past trigger
    "tests green ✓", // past integrate
    `PR #${PR_START + i} merged ✓`, // past deploy
  ];
}

function initRides(root: HTMLElement) {
  const wrap = root.querySelector<HTMLElement>(".flow-wrap");
  const spine = root.querySelector<HTMLElement>(".spine");
  const rides = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(".ride"));
  if (!wrap || !spine || rides.length === 0) return () => {};

  const SPEED = 110; // px per second down the pipe
  let tweens: gsap.core.Tween[] = [];

  function nodeCenters() {
    if (!wrap) return [];
    const wrapTop = wrap.getBoundingClientRect().top + window.scrollY;
    return ["trigger", "integrate", "deploy"].map((key) => {
      const node = root.querySelector(`[data-station="${key}"] .node`);
      if (!node) return 0;
      const r = node.getBoundingClientRect();
      return r.top + window.scrollY - wrapTop + r.height / 2;
    });
  }

  function endY() {
    const end = root.querySelector(".shipped .node-end");
    if (!end || !wrap) return 0;
    const wrapTop = wrap.getBoundingClientRect().top + window.scrollY;
    const r = end.getBoundingClientRect();
    return r.top + window.scrollY - wrapTop + r.height / 2;
  }

  function build() {
    for (const t of tweens) t.kill();
    tweens = [];
    const stations = nodeCenters();
    const finish = endY();
    if (finish === 0) return;
    const duration = finish / SPEED;

    rides.forEach((ride, i) => {
      const labels = rideLabels(ride.dataset.src ?? "", i);
      const label = ride.querySelector("span");
      if (!label) return;
      let stageIdx = -2; // sentinel so the first setStage(-1) applies

      const setStage = (idx: number) => {
        if (idx === stageIdx) return;
        stageIdx = idx;
        label.textContent = idx < 0 ? labels[0] : labels[idx + 1];
        ride.classList.toggle("is-merged", idx >= 2);
      };
      setStage(-1);

      const tween = gsap.fromTo(
        ride,
        { y: -40, opacity: 0 },
        {
          y: finish,
          duration,
          ease: "none",
          repeat: -1,
          delay: (duration / rides.length) * i,
          onUpdate() {
            const y = Number(gsap.getProperty(ride, "y"));
            let idx = -1;
            for (let s = 0; s < stations.length; s++) if (y >= stations[s]) idx = s;
            setStage(idx);
            // fade in at the inlet, fade out into the end node
            const fadeIn = gsap.utils.clamp(0, 1, (y + 40) / 140);
            const fadeOut = gsap.utils.clamp(0, 1, (finish - y) / 140);
            gsap.set(ride, { opacity: Math.min(fadeIn, fadeOut) });
          },
          onRepeat() {
            setStage(-1);
          },
        },
      );
      tweens.push(tween);
    });
  }

  build();
  // station positions settle once Mondwest finishes loading
  document.fonts?.ready.then(build).catch(() => {});

  let resizeT: ReturnType<typeof setTimeout>;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(build, 250);
  };
  window.addEventListener("resize", onResize, { passive: true });

  return () => {
    clearTimeout(resizeT);
    window.removeEventListener("resize", onResize);
    for (const t of tweens) t.kill();
  };
}

function initHero() {
  const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
  tl.from(".hero-title .line-inner", { yPercent: 112, duration: 1.1, stagger: 0.12 }, 0.1)
    .from(".hero-annot", { opacity: 0, y: -8, duration: 0.7 }, 0.4)
    .from(".hero-sub, .hero-cta", { opacity: 0, y: 24, duration: 0.9, stagger: 0.1 }, 0.55)
    .from(".inlet, .hero-hint", { opacity: 0, duration: 1.2 }, 0.9);
}

function initReveals(root: HTMLElement) {
  for (const el of gsap.utils.toArray<HTMLElement>(
    root.querySelectorAll(".station .station-body > *, .station .station-num"),
  )) {
    gsap.from(el, {
      opacity: 0,
      y: 26,
      duration: 0.7,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 86%" },
    });
  }

  for (const el of gsap.utils.toArray<HTMLElement>(
    root.querySelectorAll(".pipe-head, .run-copy, .terms-row > *, .shipped"),
  )) {
    gsap.from(el, {
      opacity: 0,
      y: 30,
      duration: 0.8,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 84%" },
    });
  }

  gsap.from(".close-title .line-inner", {
    yPercent: 112,
    duration: 1,
    stagger: 0.1,
    ease: "power4.out",
    scrollTrigger: { trigger: ".close", start: "top 60%" },
  });
  gsap.from(".close-kicker, .close-cta", {
    opacity: 0,
    y: 20,
    duration: 0.8,
    stagger: 0.15,
    ease: "power3.out",
    scrollTrigger: { trigger: ".close", start: "top 55%" },
  });
}

function initWedge() {
  gsap.to(".strike-wrap", {
    "--strike": 1,
    duration: 0.9,
    ease: "power3.inOut",
    scrollTrigger: { trigger: ".wedge-title", start: "top 70%" },
  });
  gsap.from(".wedge-cols > *", {
    opacity: 0,
    y: 28,
    duration: 0.8,
    stagger: 0.15,
    ease: "power3.out",
    scrollTrigger: { trigger: ".wedge-cols", start: "top 80%" },
  });
}

function initTerminal(root: HTMLElement) {
  const cmd = root.querySelector<HTMLElement>("[data-type]");
  const lines = gsap.utils.toArray<HTMLElement>(root.querySelectorAll("[data-line]"));
  if (!cmd) return;

  cmd.textContent = "";
  gsap.set(lines, { opacity: 0 });

  const tl = gsap.timeline({
    scrollTrigger: { trigger: ".terminal", start: "top 72%" },
  });
  tl.to(
    {},
    {
      duration: TERMINAL_CMD.length * 0.045,
      ease: "none",
      onUpdate() {
        cmd.textContent = TERMINAL_CMD.slice(0, Math.round(this.progress() * TERMINAL_CMD.length));
      },
    },
  ).to(lines, { opacity: 1, duration: 0.01, stagger: 0.3 }, "+=0.35");

  gsap.from(".terminal", {
    opacity: 0,
    y: 40,
    duration: 0.9,
    ease: "power3.out",
    scrollTrigger: { trigger: ".terminal", start: "top 85%" },
  });
}

export function MarketingLandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.style.scrollBehavior = reduced ? "auto" : "smooth";

    if (reduced) {
      root.querySelector<HTMLElement>(".strike-wrap")?.style.setProperty("--strike", "1");
      return () => {
        document.documentElement.style.scrollBehavior = "";
      };
    }

    gsap.registerPlugin(ScrollTrigger);
    let cleanupRides: () => void = () => {};
    const ctx = gsap.context(() => {
      cleanupRides = initRides(root);
      initHero();
      initReveals(root);
      initWedge();
      initTerminal(root);
    }, root);

    return () => {
      document.documentElement.style.scrollBehavior = "";
      cleanupRides();
      ctx.revert();
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => {
      // the hamburger only exists ≤860px; close the menu if the viewport outgrows it
      if (window.innerWidth > 860) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="mlp" ref={rootRef}>
      <header className="nav">
        <a className="nav-brand" href="#top" aria-label="Mogplex home">
          <MogplexWordmark className="wordmark" height={20} />
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#pipeline">Product</a>
          <Link href="/workflows">Workflows</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/faq">FAQ</Link>
          <a href="https://docs.mogplex.com">Docs</a>
          <Link href="/login">Sign in</Link>
        </nav>
        <Link className="btn btn-primary btn-sm nav-cta" href="/request-access">
          Request access
        </Link>
        <button
          className="nav-toggle"
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="bar" aria-hidden />
          <span className="bar" aria-hidden />
        </button>
      </header>

      {/* full-screen menu behind the fixed nav; toggled on small screens only */}
      <div className={`mobile-menu${menuOpen ? " is-open" : ""}`} id="mobile-menu">
        <nav className="mobile-links" aria-label="Mobile">
          <a href="#pipeline" onClick={closeMenu}>Product</a>
          <Link href="/workflows" onClick={closeMenu}>Workflows</Link>
          <Link href="/how-it-works" onClick={closeMenu}>How it works</Link>
          <Link href="/faq" onClick={closeMenu}>FAQ</Link>
          <a href="https://docs.mogplex.com" onClick={closeMenu}>Docs</a>
        </nav>
        <div className="mobile-cta">
          <Link className="btn btn-primary" href="/request-access" onClick={closeMenu}>
            Request access
          </Link>
          <Link className="btn btn-ghost" href="/login" onClick={closeMenu}>
            Sign in
          </Link>
        </div>
      </div>

      <main id="top">
        {/* everything inside flow-wrap shares one continuous pipe */}
        <div className="flow-wrap">
          <div className="spine" aria-hidden>
            <i className="ride" data-src="git push origin main"><b /><span /></i>
            <i className="ride" data-src="cron · nightly 02:00"><b /><span /></i>
            <i className="ride" data-src="issue #88 opened"><b /><span /></i>
            <i className="ride" data-src="slack: fix the flaky e2e"><b /><span /></i>
          </div>
          <div className="rail-right" aria-hidden />

          {/* ============ HERO ============ */}
          <section className="hero" id="hero" data-testid="landing-hero">
            <p className="inlet mono" aria-hidden>
              ↓ intent enters the pipe
            </p>

            <div className="hero-annot mono" aria-hidden>
              <span>MOGPLEX</span>
              <span className="annot-rule" />
              <span>AGENTIC CI/CD</span>
              <span className="annot-rule" />
              <span>FIG. 01 — THE PIPE</span>
            </div>

            <h1 className="hero-title">
              <span className="line"><span className="line-inner">The pipeline</span></span>
              <span className="line">
                <span className="line-inner">
                  that ships <em className="grad">itself</em>.
                </span>
              </span>
            </h1>

            <div className="hero-lower">
              <p className="hero-sub">
                You already trust CI/CD to carry a commit from push to production. Mogplex carries{" "}
                <strong>intent</strong>: GitHub events, schedules, Slack asks, standing assignments.
                From trigger to shipped code, with agents (Claude Code, Codex, your MCP tools) doing
                the work in between.
              </p>
              <div className="hero-cta">
                <div className="hero-cta-row">
                  <Link
                    className="btn btn-primary"
                    href="/request-access"
                    data-testid="landing-request-access-link"
                  >
                    Get an access code
                  </Link>
                  <Link className="btn btn-ghost" href="/login">
                    Have a code? Sign in
                  </Link>
                </div>
                <p className="mono micro">
                  {`private beta${SEP}free while we learn${SEP}your model keys${SEP}your gates`}
                </p>
              </div>
            </div>

            <p className="hero-hint mono" aria-hidden>
              the marks travelling this line are intents.{" "}
              <span className="hint-more">watch one become a merged PR. </span>↓
            </p>
          </section>

          {/* ============ MARQUEE ============ */}
          <div className="marquee" aria-hidden>
            <div className="marquee-track mono">
              {/* two identical halves; the loop translates exactly one half (-50%) */}
              <span>{MARQUEE_HALF}</span>
              <span>{MARQUEE_HALF}</span>
            </div>
          </div>

          {/* ============ STATIONS ============ */}
          <section className="pipeline" id="pipeline">
            <div className="pipe-head">
              <p className="kicker mono">FIG. 02 — THREE STATIONS</p>
              <h2 className="h2">
                Classic CI/CD automated the path <em>after</em> the code was written. Agentic CI/CD
                automates the writing&nbsp;too.
              </h2>
            </div>

            <article className="station" data-station="trigger">
              <span className="node" aria-hidden />
              <span className="station-num" aria-hidden>01</span>
              <div className="station-body">
                <p className="station-kicker mono">WAKE</p>
                <h3 className="station-name">Trigger</h3>
                <p className="station-desc">
                  An issue opens, a PR needs review, CI fails, a schedule fires, or someone asks in
                  Slack. Mogplex catches the event and queues a run with the right agent, repo, and
                  context. No webhook plumbing, no glue scripts.
                </p>
                <ul className="station-spec mono">
                  <li>github events</li>
                  <li>ci failures</li>
                  <li>slack</li>
                  <li>cron</li>
                  <li>standing assignments</li>
                </ul>
              </div>
            </article>

            <article className="station" data-station="integrate">
              <span className="node" aria-hidden />
              <span className="station-num" aria-hidden>02</span>
              <div className="station-body">
                <p className="station-kicker mono">BUILD</p>
                <h3 className="station-name">Continuous Agentic Integration</h3>
                <p className="station-desc">
                  A per-run sandbox boots with your repo. The agent writes, runs tests, and uses
                  your MCP tools, iterating until it holds together. Every call is metered and
                  logged: you know what it did and what it cost.
                </p>
                <ul className="station-spec mono">
                  <li>per-run sandbox</li>
                  <li>claude code · codex</li>
                  <li>every call metered</li>
                </ul>
              </div>
            </article>

            <article className="station" data-station="deploy">
              <span className="node" aria-hidden />
              <span className="station-num" aria-hidden>03</span>
              <div className="station-body">
                <p className="station-kicker mono">SHIP</p>
                <h3 className="station-name">Continuous Agentic Deployment</h3>
                <p className="station-desc">
                  Output ships as a PR, a check run, or a merged change, behind the gates you set.
                  Deploys reconcile back to the run that caused them, and your branch protections
                  still rule.
                </p>
                <ul className="station-spec mono">
                  <li>PR → merge → deploy</li>
                  <li>your approval gates</li>
                  <li>branch protections rule</li>
                </ul>
              </div>
            </article>
          </section>

          {/* ============ WEDGE ============ */}
          <section className="wedge" id="difference">
            <p className="kicker mono">FIG. 03 — THE DIFFERENCE</p>
            <h2 className="wedge-title">
              <span className="strike-wrap">Staffing is a tool you use.</span>
              <br />
              Infrastructure is a thing you <em>build on</em>.
            </h2>
            <div className="wedge-cols">
              <div className="wedge-col wedge-them">
                <p className="mono wedge-label">DELEGATION PLATFORMS</p>
                <p>
                  Hire droids. Assign tasks. Review their output one at a time. Every task is a
                  transaction; when you stop delegating, everything stops.
                </p>
              </div>
              <div className="wedge-col wedge-us">
                <p className="mono wedge-label us">MOGPLEX</p>
                <p>
                  Wire a pipeline once. Work flows through it continuously: while you sleep, while
                  you build something else, while you&apos;re not looking. Infrastructure is
                  stickier than staffing.
                </p>
              </div>
            </div>
          </section>

          {/* ============ RUN ============ */}
          <section className="run" id="run">
            <div className="run-copy">
              <p className="kicker mono">FIG. 04 — HANDS ON</p>
              <h2 className="h2">Build it. Watch it run. Step in when it matters.</h2>
              <p className="body-lg">
                The web app and CLI are where you wire the pipeline, watch agents work, inspect any
                run call-by-call, and step into one already in motion: approve the next tool call,
                redirect the plan, or kill it.
              </p>
              <p className="install mono" id="install">
                <span className="t-dim">$</span> curl -fsSL https://install.mogplex.com/install.sh
                | sh
              </p>
              <p className="mono micro install-note">
                {`open-source Apache 2.0 CLI${SEP}your access code authenticates it`}
              </p>
            </div>

            <div
              className="terminal"
              role="img"
              aria-label="Terminal session: mogplex wire nightly-deps creates a live pipeline with trigger, integrate and deploy stages"
            >
              <div className="terminal-bar">
                <span className="tdot" />
                <span className="tdot" />
                <span className="tdot" />
                <span className="terminal-title mono">mogplex — zsh</span>
              </div>
              <pre className="terminal-body mono" id="term">
                <span className="t-prompt">$</span> <span className="t-cmd" data-type="">{TERMINAL_CMD}</span>
                {"\n"}
                <span className="t-line" data-line="">
                  <span className="t-ok">✓</span> auth        <span className="t-dim">access code · ok</span>
                </span>
                {"\n"}
                <span className="t-line" data-line="">
                  <span className="t-ok">✓</span> trigger     <span className="t-dim">schedule · 02:00 UTC</span>
                </span>
                {"\n"}
                <span className="t-line" data-line="">
                  <span className="t-ok">✓</span> integrate   <span className="t-dim">sandbox · write · test · iterate</span>
                </span>
                {"\n"}
                <span className="t-line" data-line="">
                  <span className="t-ok">✓</span> deploy      <span className="t-dim">PR → merge · gate: you</span>
                </span>
                {"\n"}
                <span className="t-line" data-line="" />
                {"\n"}
                <span className="t-line" data-line="">
                  <span className="t-sig">◆ pipeline live.</span> <span className="t-dim">your repo keeps moving.</span>
                </span>
                {"\n"}
                <span className="t-caret" aria-hidden />
              </pre>
            </div>
          </section>

          {/* ============ TERMS ============ */}
          <section className="terms">
            <div className="terms-row">
              <div className="term">
                <p className="term-k mono">MODELS</p>
                <p className="term-v">
                  Model access included. Pick the agent and model per pipeline — no API keys to set up.
                </p>
              </div>
              <div className="term">
                <p className="term-k mono">METER</p>
                <p className="term-v">
                  Free in private beta. Every model and tool call is metered, observed call-by-call.
                </p>
              </div>
              <div className="term">
                <p className="term-k mono">GATES</p>
                <p className="term-v">
                  Nothing ships without passing the gates you set. Autonomy is configurable.
                </p>
              </div>
            </div>

            <div className="shipped">
              <span className="node node-end" aria-hidden />
              <p className="mono shipped-label">
                <b>SHIPPED.</b> &nbsp;the pipe loops back to trigger &nbsp;↺
              </p>
            </div>
          </section>
        </div>
        {/* /flow-wrap */}

        {/* ============ CLOSE (inverted) ============ */}
        <section className="close">
          <p className="kicker mono close-kicker">REV 01 — SHIP IT</p>
          <h2 className="close-title">
            <span className="line"><span className="line-inner">Set the gates.</span></span>
            <span className="line"><span className="line-inner">Let it ship.</span></span>
          </h2>
          <div className="close-cta">
            <Link className="btn btn-inverse" href="/request-access">
              Get an access code
            </Link>
            <p className="mono micro">
              private beta, approving in batches. free while we learn what you need.
            </p>
          </div>
          <div className="close-flow" aria-hidden />
        </section>
      </main>

      <footer className="footer">
        <div className="footer-brand">
          <svg
            className="mark"
            width="18"
            height="18"
            viewBox="0 0 32 32"
            fill="currentColor"
            aria-hidden
          >
            <path d="M16.0002 26.6667L10.667 32L0 21.3335L5.33326 15.9998L16.0002 26.6667ZM32.0005 21.3335L21.3335 32L16.0002 26.6667L26.6667 15.9998L32.0005 21.3335ZM16.0002 5.33326L5.33326 15.9998L0.000460359 10.667L10.667 0L16.0002 5.33326ZM32.0005 10.6665L26.6667 15.9998L16.0002 5.33326L21.3335 0L32.0005 10.6665Z" />
          </svg>
          <span className="mono">MOGPLEX — AGENTIC CI/CD</span>
        </div>
        <nav className="footer-links mono" aria-label="Footer">
          <Link href="/workflows">Workflows</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/faq">FAQ</Link>
          <a href="https://docs.mogplex.com">Docs</a>
          <Link href="/request-access">Request access</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://x.com/mogplex">@mogplex</a>
        </nav>
        <p className="mono footer-fine">© 2026 Webrenew · Mogplex. Drawn to scale.</p>
      </footer>
    </div>
  );
}
