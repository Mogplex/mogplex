"use client";

import { useEffect, useRef, useState } from "react";

import { MogplexMark } from "@/components/brand/mogplex-mark";
import { ArrowRight } from "@/components/marketing/mpx-chrome";

import {
  changedFiles,
  planSteps,
  railItems,
  TERMINAL_DATA,
} from "./data";
import {
  DotCheck,
  GearIcon,
  PendingRing,
  PingDot,
  RingCheck,
  Spinner,
  StepIcon,
} from "./icons";
import { LiveRunTerminal } from "./live-run-terminal";

// The timeline intentionally derives several visible states from one phase.
// eslint-disable-next-line complexity
export function LiveRunMockup() {
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
              className={`mpx-file-card${filesVisible ? " is-visible" : ""}${fileRing ? " is-ringed" : ""}`}
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

          <LiveRunTerminal
            tab={tab}
            setTab={setTab}
            visibleLines={visibleLines}
            deploySeconds={deploySeconds}
          />
        </section>
      </div>
    </div>
  );
}
