"use client";

import type { TerminalLine } from "./data";

interface LiveRunTerminalProps {
  tab: "terminal" | "logs" | "events";
  setTab: (tab: "terminal" | "logs" | "events") => void;
  visibleLines: TerminalLine[];
  deploySeconds: number;
}

export function LiveRunTerminal({
  tab,
  setTab,
  visibleLines,
  deploySeconds,
}: LiveRunTerminalProps) {
  return (
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
  );
}
