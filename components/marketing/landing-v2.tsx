"use client";

import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { MogplexMark } from "@/components/brand/mogplex-mark";
import {
  AccentPeriod,
  ArrowRight,
  BlueprintOverlay,
  Eyebrow,
  GITHUB_URL,
  MpxFooter,
  MpxHeader,
  plexMono,
} from "@/components/marketing/mpx-chrome";

import "./landing-v2.css";

/* plan / node step icons — traced from the reference mock */
function StepIcon({
  name,
}: {
  name: "planner" | "implement" | "review" | "deploy";
}) {
  if (name === "planner") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <circle cx="6" cy="6" r="2.2" />
        <circle cx="18" cy="6" r="2.2" />
        <circle cx="12" cy="18" r="2.2" />
        <path d="M8 6h8M7.5 7.8 10.8 16M16.5 7.8 13.2 16" />
      </svg>
    );
  }
  if (name === "implement") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m8.5 8.5-4 3.5 4 3.5M15.5 8.5l4 3.5-4 3.5" />
      </svg>
    );
  }
  if (name === "review") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="9.5" cy="8" r="3" />
        <path d="M4 19c.6-3 2.8-4.6 5.5-4.6 1.3 0 2.5.3 3.4 1M14.5 12.5l1.8 1.8 3.2-3.6" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5.5 14.5c-1.4 1.4-2 5-2 5s3.6-.6 5-2M14 4.2c2.8-1 5.8-1 5.8-1s0 3-1 5.8c-1.5 4.4-5.9 7.8-8.8 9l-4-4c1.2-2.9 4.6-7.3 8-9.8z" />
      <circle cx="15" cy="9" r="1.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" />
    </svg>
  );
}

/* run-status snippets */
function DotCheck() {
  return (
    <span className="mpx-dotcheck" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 13 4 4L19 7" />
      </svg>
    </span>
  );
}

function RingCheck() {
  return (
    <svg
      className="mpx-ringcheck"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.6" />
      <path d="m8.4 12.4 2.5 2.5 4.9-5.4" />
    </svg>
  );
}

function PendingRing() {
  return <span className="mpx-pending" aria-hidden />;
}

function Spinner() {
  return <span className="mpx-spinner" aria-hidden />;
}

function PingDot() {
  return (
    <span className="mpx-ping" aria-hidden>
      <span className="is-wave" />
      <span className="is-core" />
    </span>
  );
}


/* ── live run mockup ──────────────────────────────────────────── */

type TerminalLine = {
  t: string;
  lvl: "PASS" | "INFO" | "RUN";
  ev: string;
  plain: string;
  diff?: boolean;
  dyn?: boolean;
};

const TERMINAL_DATA: TerminalLine[] = [
  {
    t: "10:24:31",
    lvl: "PASS",
    ev: "agent.planner.completed",
    plain: "Planner agent completed in 1.2s",
  },
  {
    t: "10:24:32",
    lvl: "INFO",
    ev: "agent.implement.started",
    plain: "Implement agent started",
  },
  {
    t: "10:24:50",
    lvl: "PASS",
    ev: "agent.implement.completed",
    plain: "Implement agent: 3 files changed (+142 −18)",
    diff: true,
  },
  {
    t: "10:24:53",
    lvl: "PASS",
    ev: "review.security.passed",
    plain: "Review (security) checks passed",
  },
  {
    t: "10:24:55",
    lvl: "PASS",
    ev: "review.quality.passed",
    plain: "Review (code quality) checks passed",
  },
  {
    t: "10:24:57",
    lvl: "RUN",
    ev: "deploy.staging.started",
    plain: "Deploy agent: deploying to staging",
  },
  {
    t: "10:25:19",
    lvl: "RUN",
    ev: "deploy.staging.progress",
    plain: "Deployment in progress",
    dyn: true,
  },
];

const railItems = [
  {
    label: "Pipelines",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="6" cy="6" r="2.3" />
        <circle cx="6" cy="18" r="2.3" />
        <circle cx="18" cy="12" r="2.3" />
        <path d="M7.9 7.4 15.9 11M7.9 16.6 15.9 13" />
      </svg>
    ),
  },
  {
    label: "Workspaces",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
      </svg>
    ),
  },
  {
    label: "Terminal",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 8 3.6 3.6L6 15.2M12 15.5h6" />
      </svg>
    ),
  },
  {
    label: "Artifacts",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="8.6" cy="10" r="1.4" />
        <path d="m20.5 15.5-4.2-4.2L9 18.5" />
      </svg>
    ),
  },
  { label: "Settings", icon: <GearIcon /> },
] as const;

const planSteps = [
  {
    icon: "planner",
    name: "PLANNER",
    desc: "Break down and sequence the work",
  },
  { icon: "implement", name: "IMPLEMENT", desc: "Write code and add tests" },
  {
    icon: "review",
    name: "REVIEW",
    desc: "Assess changes and request updates",
  },
  { icon: "deploy", name: "DEPLOY", desc: "Merge, build, and roll out safely" },
] as const;

const changedFiles = [
  ["middleware/rate_limit.py", "+78", "−2"],
  ["tests/test_rate_limit.py", "+45", "−0"],
  ["app/api/routes.py", "+19", "−16"],
] as const;

// The timeline intentionally derives several visible states from one phase.
// eslint-disable-next-line complexity
function LiveRunMockup() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);
  const [fading, setFading] = useState(false);
  const [tab, setTab] = useState<"terminal" | "logs" | "events">("terminal");
  const [implSeconds, setImplSeconds] = useState(13);
  const [deploySeconds, setDeploySeconds] = useState(0);
  const [fileRing, setFileRing] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const mockup = mockupRef.current;
    if (!wrap || !mockup) return;

    const resize = () => {
      const scale = Math.min(1.12, wrap.clientWidth / 920);
      mockup.style.transform = `scale(${scale})`;
      wrap.style.height = `${660 * scale}px`;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const reducedMotionTimer = setTimeout(() => {
        setPhase(8);
        setImplSeconds(18);
        setDeploySeconds(22);
      }, 0);
      return () => clearTimeout(reducedMotionTimer);
    }

    let cancelled = false;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      setPhase(0);
      setFading(false);
      setImplSeconds(13);
      setDeploySeconds(0);
      const sequence = [
        [1100, 1],
        [6100, 2],
        [6450, 3],
        [7200, 4],
        [8200, 5],
        [8900, 6],
        [9700, 7],
        [10100, 8],
      ] as const;
      timers = sequence.map(([delay, next]) =>
        setTimeout(() => {
          if (!cancelled) setPhase(next);
        }, delay)
      );
      timers.push(
        setTimeout(() => {
          if (!cancelled) setFading(true);
        }, 17_100),
        setTimeout(() => {
          if (!cancelled) run();
        }, 17_480)
      );
    };
    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  /* implement 13s → 18s while running; deploy 0s → 22s once started */
  useEffect(() => {
    if (phase !== 1) return;
    const interval = setInterval(
      () => setImplSeconds((s) => Math.min(18, s + 1)),
      700
    );
    return () => clearInterval(interval);
  }, [phase]);
  useEffect(() => {
    if (phase < 7) return;
    const interval = setInterval(
      () => setDeploySeconds((s) => Math.min(22, s + 1)),
      255
    );
    return () => clearInterval(interval);
  }, [phase]);

  const progressActive = phase >= 1;
  const implementDone = phase >= 2;
  const filesVisible = phase >= 3;
  const reviewsRunning = phase >= 4;
  const reviewLeftDone = phase >= 5;
  const reviewsDone = phase >= 6;
  const deployRunning = phase >= 7;
  const visibleLines = TERMINAL_DATA.slice(
    0,
    phase >= 8
      ? 7
      : phase >= 7
        ? 6
        : phase >= 6
          ? 5
          : phase >= 5
            ? 4
            : phase >= 2
              ? 3
              : 2
  );

  const flashFileCard = () => {
    setFileRing(true);
    setTimeout(() => setFileRing(false), 1000);
  };

  const reviewStatus = (done: boolean) =>
    done ? (
      <>
        <span className="mpx-pass-pill">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
          Checks passed
        </span>
        <DotCheck />
      </>
    ) : reviewsRunning ? (
      <span className="mpx-status is-run">Running checks…</span>
    ) : (
      <span className="mpx-status">Queued</span>
    );

  return (
    <div className="mpx-run-scale-wrap" ref={wrapRef}>
      <div
        className={fading ? "mpx-run-ui is-fading" : "mpx-run-ui"}
        ref={mockupRef}
        data-phase={phase}
      >
        <aside className="mpx-run-rail" aria-label="Run navigation">
          <MogplexMark className="mpx-run-mark" />
          {railItems.map(({ label, icon }, index) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              data-active={index === 0}
            >
              {icon}
            </button>
          ))}
          <span className="mpx-avatar">
            MA
            <i />
          </span>
        </aside>

        <aside className="mpx-run-plan">
          <strong className="mpx-accent">RUN 4821</strong>
          <p className="mpx-run-commit">
            <b>main</b>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <circle cx="6" cy="6" r="2" />
              <circle cx="6" cy="18" r="2" />
              <circle cx="18" cy="8" r="2" />
              <path d="M6 8.2v7.6M18 10.2c0 3.8-4 3.8-8 3.8" />
            </svg>
            <span>a1b2c3d</span>
          </p>
          <div className="mpx-intent-card">
            <small>INTENT</small>
            <p>Add rate limiting to public API endpoints</p>
            <span>#4821</span>
          </div>
          <small className="mpx-plan-label">AGENT&nbsp;PLAN</small>
          <div className="mpx-plan-steps">
            <div>
              <i>
                <StepIcon name="planner" />
              </i>
              <span>
                <b>PLANNER</b>
                <small>{planSteps[0].desc}</small>
              </span>
              <RingCheck />
            </div>
            <div>
              <i>
                <StepIcon name="implement" />
              </i>
              <span>
                <b>IMPLEMENT</b>
                <small>{planSteps[1].desc}</small>
              </span>
              {implementDone ? <RingCheck /> : <Spinner />}
            </div>
            <div>
              <i>
                <StepIcon name="review" />
              </i>
              <span>
                <b>REVIEW</b>
                <small>{planSteps[2].desc}</small>
              </span>
              {reviewsDone ? (
                <RingCheck />
              ) : reviewsRunning ? (
                <Spinner />
              ) : (
                <PendingRing />
              )}
            </div>
            <div>
              <i>
                <StepIcon name="deploy" />
              </i>
              <span>
                <b>DEPLOY</b>
                <small>{planSteps[3].desc}</small>
              </span>
              {deployRunning ? <PingDot /> : <PendingRing />}
            </div>
          </div>
          <button
            className="mpx-full-log"
            type="button"
            onClick={() => setTab("logs")}
          >
            View full run log
            <ArrowRight className="mpx-arrow" />
          </button>
        </aside>

        <section
          className="mpx-run-canvas"
          aria-label="Animated agent run 4821"
        >
          <div className="mpx-run-topbar">
            <span
              className={
                reviewsDone ? "mpx-top-check is-visible" : "mpx-top-check"
              }
            >
              <RingCheck /> Checks passed
            </span>
            <div>
              <span
                className={
                  filesVisible ? "mpx-files-pill is-visible" : "mpx-files-pill"
                }
              >
                3 files changed <b>+142</b> <em>−18</em>
              </span>
              <button type="button" onClick={flashFileCard}>
                View changes
              </button>
              <button
                type="button"
                aria-label="Run settings"
                className="is-icon"
              >
                <GearIcon />
              </button>
            </div>
          </div>

          <div className="mpx-run-graph">
            <svg
              width="600"
              height="392"
              viewBox="0 0 600 392"
              fill="none"
              aria-hidden
            >
              <g className="mpx-dag-line">
                <path d="M300 80 V96" />
                <path d="M300 188 V205 H115 V222" />
                <path d="M300 205 H485 V222" />
                <path d="M115 302 V313 H300" />
                <path d="M485 302 V313 H300" />
                <path d="M300 313 V322" />
              </g>
              <path className="mpx-dag-line is-dashed" d="M385 142 H416" />
              <g className="mpx-dag-dot">
                <circle cx="300" cy="80" r="2.5" />
                <circle cx="300" cy="96" r="2.5" />
                <circle cx="300" cy="188" r="2.5" />
                <circle cx="300" cy="205" r="2.5" />
                <circle cx="115" cy="222" r="2.5" />
                <circle cx="485" cy="222" r="2.5" />
                <circle cx="115" cy="302" r="2.5" />
                <circle cx="485" cy="302" r="2.5" />
                <circle cx="300" cy="313" r="2.5" />
                <circle cx="300" cy="322" r="2.5" />
              </g>
            </svg>

            <div className="mpx-agent-node is-planner">
              <header>
                <span>
                  <StepIcon name="planner" />
                </span>
                <small>PLANNER</small>
                <DotCheck />
              </header>
              <p>Analyzed codebase and dependencies</p>
              <time>1.2s</time>
            </div>
            <div className="mpx-agent-node is-implement">
              <header>
                <span>
                  <StepIcon name="implement" />
                </span>
                <small>IMPLEMENT</small>
                {implementDone ? <DotCheck /> : <PingDot />}
              </header>
              <p>Create rate limiter middleware and tests</p>
              <div
                className={
                  implementDone ? "mpx-node-status is-done" : "mpx-node-status"
                }
              >
                {implementDone ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : (
                  <i className="mpx-status-dot" />
                )}
                <span>{implementDone ? "Completed" : "Running"}</span>
                <time>{implementDone ? "18s" : `${implSeconds}s`}</time>
              </div>
              <div
                className={
                  implementDone
                    ? "mpx-progress is-done"
                    : progressActive
                      ? "mpx-progress is-running"
                      : "mpx-progress"
                }
              >
                <i />
              </div>
            </div>
            <div className="mpx-agent-node is-review-left">
              <header>
                <span>
                  <StepIcon name="review" />
                </span>
                <small>REVIEW</small>
                {reviewLeftDone ? (
                  <DotCheck />
                ) : reviewsRunning ? (
                  <PingDot />
                ) : (
                  <PendingRing />
                )}
              </header>
              <p>Security review</p>
              <div className="mpx-node-foot">
                {reviewStatus(reviewLeftDone)}
              </div>
            </div>
            <div className="mpx-agent-node is-review-right">
              <header>
                <span>
                  <StepIcon name="review" />
                </span>
                <small>REVIEW</small>
                {reviewsDone ? (
                  <DotCheck />
                ) : reviewsRunning ? (
                  <PingDot />
                ) : (
                  <PendingRing />
                )}
              </header>
              <p>Code quality review</p>
              <div className="mpx-node-foot">{reviewStatus(reviewsDone)}</div>
            </div>
            <div className="mpx-agent-node is-deploy">
              <header>
                <span>
                  <StepIcon name="deploy" />
                </span>
                <small>DEPLOY</small>
                {deployRunning ? <PingDot /> : <PendingRing />}
              </header>
              <p>Staging deployment</p>
              <div className="mpx-node-foot">
                {deployRunning ? (
                  <span className="mpx-status is-run">
                    <i className="mpx-status-dot" />
                    In progress <time>{deploySeconds}s</time>
                  </span>
                ) : (
                  <span className="mpx-status">Queued</span>
                )}
              </div>
            </div>

            <div
              className={`mpx-file-card${filesVisible ? "is-visible" : ""}${fileRing ? "is-ringed" : ""}`}
            >
              <strong>3 files changed</strong>
              {changedFiles.map(([file, add, del]) => (
                <p key={file}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden
                  >
                    <path d="M6 2.5h8l4 4v15H6z" />
                    <path d="M14 2.5v4h4" />
                  </svg>
                  <span>{file}</span>
                  <b>{add}</b>
                  <em>{del}</em>
                </p>
              ))}
            </div>
          </div>

          <div className="mpx-terminal">
            <header>
              {(["terminal", "logs", "events"] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  data-active={tab === name}
                  onClick={() => setTab(name)}
                >
                  {name.toUpperCase()}
                </button>
              ))}
              <div className="mpx-terminal-tools">
                <button type="button">
                  Shell{" "}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                <button type="button" aria-label="Expand terminal">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7.5 7.5M3 21l7.5-7.5" />
                  </svg>
                </button>
                <button type="button" aria-label="Clear terminal">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 13h9.2l.9-13M10 11v5.5M14 11v5.5" />
                  </svg>
                </button>
              </div>
            </header>
            <div className="mpx-terminal-body">
              {tab === "terminal" && (
                <>
                  <p className="mpx-term-line">
                    <span className="t-time is-prompt">$</span>
                    <span className="t-msg is-cmd">mogplex run 4821</span>
                  </p>
                  {visibleLines.map((line, index) => (
                    <p className="mpx-term-line" key={line.ev}>
                      <span className="t-time">{line.t}</span>
                      <span className={`t-dot is-${line.lvl.toLowerCase()}`}>
                        •
                      </span>
                      <span className="t-msg">
                        {line.diff ? (
                          <>
                            Implement agent: 3 files changed <b>(+142</b>{" "}
                            <em>−18)</em>
                          </>
                        ) : line.dyn ? (
                          <>Deployment in progress ({deploySeconds}s)</>
                        ) : (
                          line.plain
                        )}
                        {index === visibleLines.length - 1 ? (
                          <span className="t-cursor" aria-hidden />
                        ) : null}
                      </span>
                    </p>
                  ))}
                </>
              )}
              {tab === "logs" &&
                visibleLines.map((line) => (
                  <p className="mpx-term-line" key={line.ev}>
                    <span className={`t-lvl is-${line.lvl.toLowerCase()}`}>
                      [{line.lvl}]
                    </span>
                    <span className="t-msg is-plain">
                      {line.plain}
                      {line.dyn ? ` (${deploySeconds}s)` : ""}
                    </span>
                  </p>
                ))}
              {tab === "events" &&
                visibleLines.map((line) => (
                  <p className="mpx-event-line" key={line.ev}>
                    <span>
                      <i className={`is-${line.lvl.toLowerCase()}`} />
                      {line.ev}
                    </span>
                    <span className="t-time">{line.t}</span>
                  </p>
                ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}


/* ── section data ─────────────────────────────────────────────── */

const proofItems = [
  {
    label: "Zero training data",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 3 4.5 6v5.5c0 4.4 3.1 7.7 7.5 9.5 4.4-1.8 7.5-5.1 7.5-9.5V6L12 3Z" />
        <path d="m8.7 12 2.1 2.1 4.5-4.6" />
      </svg>
    ),
  },
  {
    label: "Bring your own keys",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="8" cy="15" r="4" />
        <path d="m11 12 8-8M15 4h4v4M5 18l-2 2" />
      </svg>
    ),
  },
  {
    label: "Policy-bound sandboxes",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 5h16M4 12h16M4 19h16" />
        <circle cx="8" cy="5" r="2" style={{ fill: "var(--card)" }} />
        <circle cx="15" cy="12" r="2" style={{ fill: "var(--card)" }} />
        <circle cx="10" cy="19" r="2" style={{ fill: "var(--card)" }} />
      </svg>
    ),
  },
  {
    label: "Cost-attributed traces",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 19V9M10 19V5M16 19v-7M22 19V3" />
      </svg>
    ),
  },
] as const;

const traceRows = [
  {
    label: "planner",
    time: "1.2s",
    offset: "0%",
    width: "24%",
    tone: "is-ink",
  },
  {
    label: "implement",
    time: "18.0s",
    offset: "21%",
    width: "51%",
    tone: "is-accent",
  },
  {
    label: "security",
    time: "2.1s",
    offset: "71%",
    width: "11%",
    tone: "is-green",
  },
  {
    label: "quality",
    time: "2.8s",
    offset: "71%",
    width: "16%",
    tone: "is-green",
  },
  {
    label: "deploy",
    time: "22.0s",
    offset: "86%",
    width: "14%",
    tone: "is-blue",
  },
] as const;

const harnesses = [
  {
    id: "mogplex",
    label: "Mogplex native",
    status: "VALID POLICY",
    kicker: "NATIVE ORCHESTRATION",
    name: "Mogplex harness",
    chip: "M",
    chipTone: "is-orange",
    description:
      "Full planner-to-deploy orchestration with review fan-out, durable checkpoints, and policy-aware retries.",
    bullets: [
      "Multi-agent planning and execution",
      "Native approvals and checkpoints",
      "End-to-end trace and cost graph",
    ],
    yaml: [
      ["harness", "mogplex", true],
      ["model", "fable-5", false],
      ["credentials", "vault://platform/anthropic", false],
      ["sandbox", "enterprise-restricted", false],
      ["policy", "production-default", false],
    ],
  },
  {
    id: "claude",
    label: "Claude Code",
    status: "HARNESS READY",
    kicker: "MANAGED HARNESS",
    name: "Claude Code",
    chip: "CC",
    chipTone: "is-beige",
    description:
      "Keep the Claude Code workflow developers know, wrapped in enterprise sandboxing, BYOK, approvals, and complete run telemetry.",
    bullets: [
      "Existing CLAUDE.md behavior preserved",
      "Provider key remains in your vault",
      "Central policy without workflow changes",
    ],
    yaml: [
      ["harness", "claude-code", true],
      ["model", "claude-sonnet-4-5", false],
      ["credentials", "vault://platform/anthropic", false],
      ["sandbox", "enterprise-restricted", false],
      ["telemetry", "full", false],
    ],
  },
  {
    id: "codex",
    label: "Codex",
    status: "HARNESS READY",
    kicker: "MANAGED HARNESS",
    name: "Codex",
    chip: "CX",
    chipTone: "is-white",
    description:
      "Run Codex against approved repositories and models while Mogplex captures every tool call, diff, token, and approval.",
    bullets: [
      "OpenAI keys routed through your vault",
      "Repository and command allowlists",
      "Unified spend and audit reporting",
    ],
    yaml: [
      ["harness", "codex", true],
      ["model", "gpt-5.6-sol", false],
      ["credentials", "vault://platform/openai", false],
      ["sandbox", "enterprise-restricted", false],
      ["telemetry", "full", false],
    ],
  },
] as const;

const enterpriseTiles = [
  {
    title: "SSO / SAML + SCIM",
    sub: "Identity and provisioning",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <path d="M12 3 4.5 6v5.5c0 4.4 3.1 7.7 7.5 9.5 4.4-1.8 7.5-5.1 7.5-9.5V6L12 3Z" />
      </svg>
    ),
  },
  {
    title: "VPC or self-hosted",
    sub: "Your network boundary",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <path d="M4 12h16M12 4v16" />
        <circle cx="12" cy="12" r="8" />
      </svg>
    ),
  },
  {
    title: "Immutable audit export",
    sub: "SIEM and object storage",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    title: "Enterprise SLA",
    sub: "Support and onboarding",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <path d="m5 12 4 4L19 6" />
      </svg>
    ),
  },
] as const;

const connectors = [
  ["SOURCE", "GitHub + GitLab"],
  ["IDENTITY", "Okta + Entra ID"],
  ["SECRETS", "Vault + KMS"],
  ["TELEMETRY", "OTel + Datadog"],
  ["WORKFLOW", "Slack + Jira"],
  ["DELIVERY", "CI + Kubernetes"],
] as const;

/* ── page ─────────────────────────────────────────────────────── */

export function MarketingLandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeHarness, setActiveHarness] = useState(0);
  const harnessRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /* corner brackets fade in while scrolling, matching the blueprint frame */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      rootRef.current?.classList.add("is-scrolling");
      clearTimeout(timer);
      timer = setTimeout(
        () => rootRef.current?.classList.remove("is-scrolling"),
        180
      );
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  const onHarnessKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const last = harnesses.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowRight"
            ? (index + 1) % harnesses.length
            : (index - 1 + harnesses.length) % harnesses.length;
    setActiveHarness(next);
    harnessRefs.current[next]?.focus();
  };

  const harness = harnesses[activeHarness];

  return (
    <div className={`mpx-landing ${plexMono.variable}`} ref={rootRef}>
      <BlueprintOverlay />

      <MpxHeader />

      <main>
        <section className="mpx-hero" data-testid="landing-hero">
          <div className="mpx-hero-copy">
            <div className="mpx-rise" style={{ animationDelay: ".05s" }}>
              <Eyebrow large>OPEN-SOURCE AGENTIC SOFTWARE FACTORY</Eyebrow>
            </div>
            <h1 className="mpx-rise" style={{ animationDelay: ".14s" }}>
              The open-source
              <br className="mpx-lg-break" /> agentic software
              <br className="mpx-lg-break" /> factory
              <AccentPeriod />
            </h1>
            <p className="mpx-rise" style={{ animationDelay: ".24s" }}>
              Mogplex coordinates agents that plan, build, review, and ship code
              through one inspectable pipeline.
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
                View on GitHub
              </a>
              <a className="mpx-text-link" href="#run">
                See how it works
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
                <span aria-hidden>+</span>&nbsp;&nbsp;CONTROLLED. OBSERVABLE.
                AGENTIC.
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

        <section className="mpx-proof" aria-label="Enterprise defaults">
          <Eyebrow>GOVERNED BY DEFAULT</Eyebrow>
          {proofItems.map(({ label, icon }) => (
            <div key={label}>
              <i>{icon}</i>
              <span>{label}</span>
            </div>
          ))}
        </section>

        <section id="capabilities" className="mpx-capabilities">
          <div className="mpx-section-intro">
            <div>
              <Eyebrow large>ENTERPRISE CONTROL PLANE</Eyebrow>
              <h2>
                Move at agent speed.
                <br />
                Keep enterprise control
                <AccentPeriod />
              </h2>
            </div>
            <div>
              <p>
                Standardize how every agent accesses models, code, credentials,
                and infrastructure—without slowing down the teams doing the
                work.
              </p>
              <a className="mpx-text-link is-semibold" href="#enterprise">
                Explore enterprise deployment
                <ArrowRight className="mpx-arrow" />
              </a>
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
                <span className="mpx-default-pill">DEFAULT ON</span>
              </div>
              <p className="mpx-cap-kicker">ZDR / ZERO TRAINING DATA</p>
              <h3>
                Your code is never model training data
                <AccentPeriod />
              </h3>
              <p className="mpx-cap-description">
                Provider-side retention and training are disabled by default.
                Prompts, source, and outputs stay ephemeral while the audit
                metadata you choose remains inspectable.
              </p>
              <div className="mpx-zdr-flow">
                <div>
                  <small>01 / INGRESS</small>
                  <b>Encrypted context</b>
                  <span>TLS 1.3 in transit</span>
                </div>
                <div>
                  <small>02 / EXECUTION</small>
                  <b>Ephemeral runtime</b>
                  <span>No provider retention</span>
                </div>
                <div>
                  <small>03 / EGRESS</small>
                  <b>Policy-filtered output</b>
                  <span>Secrets redacted</span>
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
                <span className="mpx-cap-stamp">CUSTOMER OWNED</span>
              </div>
              <p className="mpx-cap-kicker">BYOK / KEY ROUTING</p>
              <h3>
                Your providers. Your contracts. Your keys
                <AccentPeriod />
              </h3>
              <p className="mpx-cap-description">
                Route every request through credentials stored in your vault.
                Mogplex never becomes the system of record for model keys.
              </p>
              <div className="mpx-vault">
                <small>
                  <i aria-hidden />
                  VAULT://PLATFORM/PRODUCTION
                </small>
                {(["Anthropic", "OpenAI", "AWS Bedrock"] as const).map(
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
                <p className="mpx-cap-kicker">COMPLETE OBSERVABILITY</p>
                <h3>
                  Trace every decision down to the dollar
                  <AccentPeriod />
                </h3>
                <p className="mpx-cap-description">
                  Replay prompts, tool calls, file changes, approvals, model
                  routes, token usage, and cost from intent to deployment.
                </p>
                <div className="mpx-chips">
                  <span>OTEL EXPORT</span>
                  <span>LIVE REPLAY</span>
                  <span>COST ATTRIBUTION</span>
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
              <p className="mpx-cap-kicker">SANDBOX CONTROLS</p>
              <h3>
                Define exactly where agents can go
                <AccentPeriod />
              </h3>
              <p className="mpx-cap-description">
                Attach network, filesystem, secret, compute, and timeout
                policies to every run.
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
                  <b className="is-plain">20 MIN</b>
                </p>
              </div>
            </article>

            <article className="mpx-cap is-small-cap">
              <div className="mpx-harness-stack">
                <i>M</i>
                <i>CC</i>
                <i>CX</i>
              </div>
              <p className="mpx-cap-kicker">MULTI-HARNESS</p>
              <h3>
                One factory. Every harness
                <AccentPeriod />
              </h3>
              <p className="mpx-cap-description">
                Run Mogplex native, Claude Code, and Codex through the same
                controls, telemetry, and approval gates.
              </p>
              <a className="mpx-text-link is-semibold is-sm" href="#harnesses">
                Compare harnesses <ArrowRight className="mpx-arrow" />
              </a>
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
                <span className="mpx-cap-stamp">$18,420 / $25,000</span>
              </div>
              <p className="mpx-cap-kicker">TEAM CONTROLS</p>
              <h3>
                Budgets and models, set once
                <AccentPeriod />
              </h3>
              <p className="mpx-cap-description">
                Set spend caps, model allowlists, concurrency, and approval
                thresholds by team or workspace.
              </p>
              <div className="mpx-budget">
                <i />
              </div>
              <div className="mpx-models">
                <span>
                  <b className="is-openai">G</b>GPT 5.6 SOL ✓
                </span>
                <span>
                  <b className="is-anthropic">F</b>FABLE 5 ✓
                </span>
                <span>
                  <b className="is-kimi">K</b>KIMI K3 ✓
                </span>
                <span className="is-locked">OTHER MODELS LOCKED</span>
              </div>
            </article>

            <article className="mpx-cap is-small-cap">
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
                  <circle cx="12" cy="8" r="3" />
                  <path d="M6.5 20v-2.2c0-3.2 2.2-5 5.5-5s5.5 1.8 5.5 5V20M18.5 6.5 20 8l2.5-3" />
                </svg>
              </span>
              <p className="mpx-cap-kicker">RBAC / APPROVALS</p>
              <h3>
                The right access at every step
                <AccentPeriod />
              </h3>
              <p className="mpx-cap-description">
                Map identity groups to granular permissions and require human
                approval for sensitive actions.
              </p>
              <div className="mpx-rbac">
                <small>
                  <span>ROLE</span>
                  <b>RUN</b>
                  <b>SHIP</b>
                  <b>ADMIN</b>
                </small>
                {(
                  [
                    ["Developer", true, false, false],
                    ["Release lead", true, true, false],
                    ["Platform admin", true, true, true],
                  ] as const
                ).map(([role, run, ship, admin]) => (
                  <p key={role}>
                    <span>{role}</span>
                    {[run, ship, admin].map((on, index) => (
                      <b key={index} className={on ? "is-on" : ""}>
                        ●
                      </b>
                    ))}
                  </p>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section id="harnesses" className="mpx-harnesses">
          <div className="mpx-harness-inner">
            <div className="mpx-harness-heading">
              <div>
                <Eyebrow large>HARNESS LAYER</Eyebrow>
                <h2>
                  Any harness.
                  <br />
                  <span>Same factory.</span>
                </h2>
              </div>
              <p className="mpx-harness-lede">
                Let every team use the coding agent they prefer while security
                and platform teams keep one policy, telemetry, and cost layer.
              </p>
            </div>
            <div
              className="mpx-harness-tabs"
              role="tablist"
              aria-label="Available coding harnesses"
            >
              {harnesses.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => {
                    harnessRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`harness-tab-${item.id}`}
                  aria-selected={index === activeHarness}
                  aria-controls={`harness-panel-${item.id}`}
                  tabIndex={index === activeHarness ? 0 : -1}
                  onClick={() => setActiveHarness(index)}
                  onKeyDown={(event) => onHarnessKeyDown(event, index)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div
              className="mpx-harness-panel"
              role="tabpanel"
              id={`harness-panel-${harness.id}`}
              aria-labelledby={`harness-tab-${harness.id}`}
            >
              <div className="mpx-code-panel">
                <header>
                  <span>MOGPLEX.YAML</span>
                  <b>
                    <i aria-hidden />
                    {harness.status}
                  </b>
                </header>
                <pre>
                  <code>
                    <span className="t-root">run:</span>
                    {"\n"}
                    {harness.yaml.map(([key, value, hot]) => (
                      <Fragment key={key}>
                        {"  "}
                        {key}:{" "}
                        <span className={hot ? "t-hot" : "t-val"}>{value}</span>
                        {"\n"}
                      </Fragment>
                    ))}
                  </code>
                </pre>
              </div>
              <div className="mpx-harness-copy">
                <div className="mpx-harness-id">
                  <span className={`mpx-harness-chip ${harness.chipTone}`}>
                    {harness.chip}
                  </span>
                  <div>
                    <p>{harness.kicker}</p>
                    <b>{harness.name}</b>
                  </div>
                </div>
                <p className="mpx-harness-desc">{harness.description}</p>
                <ul>
                  {harness.bullets.map((bullet) => (
                    <li key={bullet}>
                      <span aria-hidden>+</span>
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="enterprise" className="mpx-enterprise">
          <div className="mpx-enterprise-card">
            <div className="mpx-enterprise-copy">
              <Eyebrow large>BUILT FOR YOUR ENVIRONMENT</Eyebrow>
              <h2>
                Standardize agents across the enterprise
                <AccentPeriod />
              </h2>
              <p>
                Connect the identity, source control, secrets, telemetry, and
                communication systems you already trust. Deploy in Mogplex
                Cloud, your VPC, or fully self-hosted.
              </p>
              <div className="mpx-enterprise-actions">
                <a
                  className="mpx-button is-primary"
                  href="mailto:enterprise@mogplex.com"
                >
                  Talk to enterprise
                </a>
                <a className="mpx-button is-secondary" href="#capabilities">
                  Review controls
                </a>
              </div>
              <div className="mpx-enterprise-tiles">
                {enterpriseTiles.map(({ title, sub, icon }) => (
                  <div key={title}>
                    <span>{icon}</span>
                    <div>
                      <b>{title}</b>
                      <small>{sub}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mpx-connectors">
              <header>
                <p className="mpx-cap-kicker">CONNECTORS</p>
                <span>ALL SYSTEMS NOMINAL</span>
              </header>
              <h3>Fits the stack you already run.</h3>
              <div>
                {connectors.map(([label, value]) => (
                  <p key={label}>
                    <small>{label}</small>
                    <b>{value}</b>
                  </p>
                ))}
              </div>
              <aside>
                <b>
                  <i aria-hidden />
                  POLICY SYNCED
                </b>
                <p>
                  Every connector inherits workspace RBAC, secret scopes, audit
                  rules, and data controls automatically.
                </p>
              </aside>
            </div>
          </div>
        </section>
      </main>

      <MpxFooter />
    </div>
  );
}
