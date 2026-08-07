"use client";

import { Fragment, type KeyboardEvent, useRef, useState } from "react";

import { Eyebrow } from "@/components/marketing/mpx-chrome";

import { harnesses } from "./data";

export function HarnessesSection() {
  const [activeHarness, setActiveHarness] = useState(0);
  const harnessRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
    <section id="harnesses" className="mpx-harnesses">
      <div className="mpx-harness-inner">
        <div className="mpx-harness-heading">
          <div>
            <Eyebrow large>HARNESS LAYER</Eyebrow>
            <h2>
              Choose your harness.
              <br />
              <span>Same gates.</span>
            </h2>
          </div>
          <p className="mpx-harness-lede">
            Pick the coding agent for each pipeline: the native Mogplex
            agent, Claude Code, or Codex. Every harness runs in the same
            sandboxes, behind the same gates, on the same meter.
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
              <item.icon aria-hidden />
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
                    <span className={hot ? "t-hot" : "t-val"}>
                      {value}
                    </span>
                    {"\n"}
                  </Fragment>
                ))}
              </code>
            </pre>
          </div>
          <div className="mpx-harness-copy">
            <div className="mpx-harness-id">
              <span className={`mpx-harness-chip ${harness.chipTone}`}>
                <harness.icon aria-hidden />
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
  );
}
