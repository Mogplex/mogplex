import type { CSSProperties, ReactNode } from "react";

export function Eyebrow({
  children,
  large = false,
}: {
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <p className={large ? "mpx-eyebrow is-lg" : "mpx-eyebrow"}>
      <span aria-hidden>+</span>&nbsp;&nbsp;{children}
    </p>
  );
}

export function AccentPeriod() {
  return <span className="mpx-accent">.</span>;
}

/* ── blueprint overlay ────────────────────────────────────────── */

function Crosshair({
  style,
  delay,
}: {
  style: CSSProperties;
  delay?: string;
}) {
  return (
    <svg
      className="mpx-xh"
      style={delay ? { ...style, animationDelay: delay } : style}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ff4b00"
      strokeWidth="1.3"
      strokeOpacity=".85"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4.6" />
      <path d="M12 1v6.4M12 16.6V23M1 12h6.4M16.6 12H23" />
    </svg>
  );
}

export function BlueprintOverlay() {
  return (
    <div className="mpx-blueprint" aria-hidden>
      <i className="mpx-frame is-top" />
      <i className="mpx-frame is-bottom" />
      <i className="mpx-frame is-left" />
      <i className="mpx-frame is-right" />
      <i className="mpx-bracket is-nw" />
      <i className="mpx-bracket is-ne" />
      <i className="mpx-bracket is-sw" />
      <i className="mpx-bracket is-se" />
      <i className="mpx-quarter is-1" />
      <i className="mpx-quarter is-2" />
      <i className="mpx-quarter is-3" />
      <Crosshair style={{ left: 14, top: 68 }} />
      <Crosshair style={{ left: "calc(100% - 14px)", top: 68 }} delay=".9s" />
      <Crosshair style={{ left: 14, top: "calc(100% - 14px)" }} delay="1.6s" />
      <Crosshair
        style={{ left: "calc(100% - 14px)", top: "calc(100% - 14px)" }}
        delay="2.3s"
      />
      <span>021</span>
    </div>
  );
}
