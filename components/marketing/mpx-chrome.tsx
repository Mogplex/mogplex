"use client";

/* Shared chrome for every mpx marketing surface: the blueprint overlay,
   header (platform menu + mobile nav), footer, and theme menu are defined
   once here so the landing and the subpage sheets can never drift apart.
   Hash links are root-relative (/#run) so they work from any route. */

import Link from "next/link";
import { IBM_Plex_Mono, Inter_Tight } from "next/font/google";
import { type ReactNode, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { MogplexMark } from "@/components/brand/mogplex-mark";
import { MogplexWordmark } from "@/components/brand/mogplex-wordmark";

import "./landing-v2.css";

// Re-export from split modules to maintain public API
export { ArrowRight } from "./mpx-chrome-icons";
export { MpxFooter, ThemeMenu } from "./mpx-chrome-footer";
export { GITHUB_URL, SELF_HOSTING_URL } from "./mpx-chrome-constants";

import { ArrowRight, GithubGlyph, StarGlyph } from "./mpx-chrome-icons";
import { GITHUB_URL } from "./mpx-chrome-constants";

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

const GITHUB_REPO_API = "https://api.github.com/repos/mogplex/mogplex";

export async function fetchStarCount(): Promise<number | null> {
  const response = await fetch(GITHUB_REPO_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  // Private repo, rename, or rate limit → no count segment rather than a stale
  // or made-up number.
  if (!response.ok) return null;
  const data = (await response.json()) as { stargazers_count?: unknown };
  return typeof data.stargazers_count === "number"
    ? data.stargazers_count
    : null;
}

export function formatStarCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

export function shouldShowStarCount(
  count: number | null | undefined
): count is number {
  return typeof count === "number" && count > 0;
}

export function GithubPill({ small = false }: { small?: boolean }) {
  const { data: stars } = useSWR("github-stars", fetchStarCount, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 3_600_000,
  });
  const showCount = shouldShowStarCount(stars);

  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={
        showCount
          ? `View Mogplex on GitHub — ${formatStarCount(stars)} stars`
          : "View Mogplex on GitHub"
      }
      title="View Mogplex on GitHub"
      className={small ? "mpx-github-pill is-small" : "mpx-github-pill"}
    >
      <span>
        <GithubGlyph />
      </span>
      {showCount ? (
        <span>
          <StarGlyph /> {formatStarCount(stars)}
        </span>
      ) : null}
    </a>
  );
}

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
  style: React.CSSProperties;
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

/* ── platform menu data ───────────────────────────────────────── */

const platformLinks = [
  {
    label: "Orchestrator",
    description:
      "One control surface that commands every project and fans agents out in parallel.",
    href: "/#orchestrator",
  },
  {
    label: "Control plane",
    description:
      "Watch and steer every run, agent, and policy from one dashboard.",
    href: "/#control-planes",
  },
  {
    label: "Harnesses",
    description:
      "Sandboxed rigs where agents plan, build, and test code. Nothing runs on your machines.",
    href: "/#harnesses",
  },
  {
    label: "CLI",
    description:
      "Start runs, stream logs, and inspect pipelines from the terminal.",
    href: "/#run",
  },
  {
    label: "Connectors",
    description:
      "Wire GitHub, Slack, and CI into the pipeline with a few lines of config.",
    href: "/#capabilities",
  },
] as const;

function PlatformGlyph({
  label,
}: {
  label: (typeof platformLinks)[number]["label"];
}) {
  if (label === "Orchestrator") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 5.5h16v10H9.5L4 19.5v-14Z" />
        <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
      </svg>
    );
  }
  if (label === "Control plane") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      >
        <path d="M4 7.5h8.5M17.2 7.5H20M4 16.5h3.2M12.5 16.5H20" />
        <circle cx="15" cy="7.5" r="2.2" />
        <circle cx="10" cy="16.5" r="2.2" />
      </svg>
    );
  }
  if (label === "Harnesses") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 3.2h4M11 3.2v4.9L5.9 16.5a2.3 2.3 0 0 0 2 3.5h8.2a2.3 2.3 0 0 0 2-3.5L13 8.1V3.2" />
        <path d="M8.2 13.4h7.6" />
      </svg>
    );
  }
  if (label === "CLI") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <path d="m7 9.5 2.8 2.8L7 15.1M12.3 15.2H17" />
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
    >
      <path d="M9 6.5V3M15 6.5V3" />
      <path d="M7 6.5h10V11a5 5 0 0 1-10 0V6.5z" />
      <path d="M12 16v5" />
    </svg>
  );
}

/* ── header ───────────────────────────────────────────────────── */

export function MpxHeader() {
  const [platformOpen, setPlatformOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const platformButtonRef = useRef<HTMLButtonElement>(null);
  const platformMenuRef = useRef<HTMLDivElement>(null);
  const platformCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const showPlatform = () => {
    if (platformCloseTimerRef.current)
      clearTimeout(platformCloseTimerRef.current);
    setPlatformOpen(true);
  };

  const hidePlatform = (immediate = false) => {
    if (platformCloseTimerRef.current)
      clearTimeout(platformCloseTimerRef.current);
    if (immediate) {
      setPlatformOpen(false);
      return;
    }
    platformCloseTimerRef.current = setTimeout(
      () => setPlatformOpen(false),
      180
    );
  };

  useEffect(() => {
    document.body.classList.toggle("mpx-menu-open", mobileOpen);
    return () => document.body.classList.remove("mpx-menu-open");
  }, [mobileOpen]);

  useEffect(
    () => () => {
      if (platformCloseTimerRef.current)
        clearTimeout(platformCloseTimerRef.current);
    },
    []
  );

  return (
    // Focus containment lives on the header (not .mpx-platform-wrap) because
    // #platform-menu is a sibling of .mpx-nav — the menu must stay open while
    // keyboard focus travels through the nav into it.
    <header
      className="mpx-header"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !platformOpen) return;
        hidePlatform(true);
        platformButtonRef.current?.focus();
      }}
      onBlur={(event) => {
        if (!platformOpen) return;
        if (!event.currentTarget.contains(event.relatedTarget))
          hidePlatform(true);
      }}
    >
      <nav className="mpx-nav" aria-label="Primary navigation">
        <Link href="/" className="mpx-brand" aria-label="Mogplex home">
          <MogplexWordmark className="mpx-brand-wordmark" />
          <MogplexMark className="mpx-brand-mark" />
        </Link>

        <div className="mpx-nav-links">
          <div
            className="mpx-platform-wrap"
            onMouseEnter={showPlatform}
            onMouseLeave={() => hidePlatform()}
            onFocus={showPlatform}
          >
            <button
              ref={platformButtonRef}
              type="button"
              aria-haspopup="true"
              aria-expanded={platformOpen}
              aria-controls="platform-menu"
              onClick={() => setPlatformOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown") return;
                event.preventDefault();
                showPlatform();
                requestAnimationFrame(() => {
                  platformMenuRef.current
                    ?.querySelector<HTMLAnchorElement>("a")
                    ?.focus();
                });
              }}
            >
              Platform
              <svg
                className="mpx-chevron"
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
          </div>
          <Link href="/#run">Developers</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/company">Company</Link>
          <a href="https://docs.mogplex.com">Docs</a>
        </div>

        <GithubPill />
        <Link className="mpx-button is-primary is-small" href="/signup">
          Start now
        </Link>
        <button
          type="button"
          className="mpx-mobile-toggle"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span />
          <span />
        </button>
      </nav>
      <div
        id="platform-menu"
        ref={platformMenuRef}
        className={
          platformOpen ? "mpx-platform-menu is-open" : "mpx-platform-menu"
        }
        aria-hidden={!platformOpen}
        onMouseEnter={showPlatform}
        onMouseLeave={() => hidePlatform()}
      >
        <Eyebrow>PLATFORM — ONE PIPELINE, EVERY SURFACE</Eyebrow>
        <div>
          {platformLinks.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              tabIndex={platformOpen ? 0 : -1}
              onClick={() => hidePlatform(true)}
            >
              <i>
                <PlatformGlyph label={item.label} />
              </i>
              <span>
                <b>
                  {item.label}
                  <ArrowRight className="mpx-menu-arrow" />
                </b>
                <small>{item.description}</small>
              </span>
            </Link>
          ))}
        </div>
      </div>
      <nav
        id="mobile-nav"
        className="mpx-mobile-nav"
        hidden={!mobileOpen}
        aria-label="Mobile navigation"
      >
        <div className="mpx-mobile-group">
          <Link href="/#capabilities" onClick={() => setMobileOpen(false)}>
            Platform
          </Link>
          <div>
            {platformLinks.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <Link href="/#run" onClick={() => setMobileOpen(false)}>
          Developers
        </Link>
        <Link href="/pricing" onClick={() => setMobileOpen(false)}>
          Pricing
        </Link>
        <Link href="/company" onClick={() => setMobileOpen(false)}>
          Company
        </Link>
        <a
          href="https://docs.mogplex.com"
          onClick={() => setMobileOpen(false)}
        >
          Docs
        </a>
        <div className="mpx-mobile-foot">
          <GithubPill small />
        </div>
      </nav>
    </header>
  );
}
