"use client";

/* plan / node step icons — traced from the reference mock */
export function StepIcon({
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

export function GearIcon() {
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
export function DotCheck() {
  return (
    <span className="mpx-dotcheck" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--neutral-0)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 13 4 4L19 7" />
      </svg>
    </span>
  );
}

export function RingCheck() {
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

export function PendingRing() {
  return <span className="mpx-pending" aria-hidden />;
}

export function Spinner() {
  return <span className="mpx-spinner" aria-hidden />;
}

export function PingDot() {
  return (
    <span className="mpx-ping" aria-hidden>
      <span className="is-wave" />
      <span className="is-core" />
    </span>
  );
}
