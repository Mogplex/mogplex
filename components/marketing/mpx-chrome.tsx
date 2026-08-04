"use client";

/* Shared chrome for every mpx marketing surface: the blueprint overlay,
   header (platform menu + mobile nav), footer, and theme menu are defined
   once here so the landing and the subpage sheets can never drift apart.
   Hash links are root-relative (/#run) so they work from any route. */

import Link from "next/link";
import { IBM_Plex_Mono } from "next/font/google";
import { useTheme } from "next-themes";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import useSWR from "swr";

import "./landing-v2.css";

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const GITHUB_URL = "https://github.com/mogplex/mogplex";

/* ── shared icons ─────────────────────────────────────────────── */

export function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

function GithubGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.184 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.866-.014-1.7-2.782.605-3.369-1.343-3.369-1.343-.455-1.157-1.11-1.465-1.11-1.465-.908-.621.069-.608.069-.608 1.004.071 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.091-.647.349-1.088.635-1.338-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.987 1.029-2.687-.103-.253-.446-1.269.098-2.647 0 0 .84-.269 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.58 9.58 0 0 1 2.504.337c1.909-1.295 2.748-1.026 2.748-1.026.546 1.378.203 2.394.1 2.647.64.7 1.028 1.594 1.028 2.687 0 3.848-2.337 4.695-4.566 4.943.359.31.678.921.678 1.856 0 1.34-.012 2.421-.012 2.751 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.021C22 6.484 17.523 2 12 2Z" />
    </svg>
  );
}

function StarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.6-4.4 6.3-.9L12 2.8Z" />
    </svg>
  );
}

const GITHUB_REPO_API = "https://api.github.com/repos/mogplex/mogplex";

async function fetchStarCount(): Promise<number | null> {
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

function formatStarCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

export function GithubPill({ small = false }: { small?: boolean }) {
  const { data: stars } = useSWR("github-stars", fetchStarCount, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 3_600_000,
  });
  const showCount = typeof stars === "number" && stars > 0;

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
    label: "Control Planes",
    description:
      "Observe and steer every agent, run, and policy from one inspectable dashboard.",
    href: "/#control-planes",
  },
  {
    label: "Harnesses",
    description:
      "Sandboxed execution rigs where agents plan, build, and test code safely.",
    href: "/#harnesses",
  },
  {
    label: "CLI",
    description:
      "Trigger runs, stream logs, and inspect pipelines without leaving the terminal.",
    href: "/#run",
  },
  {
    label: "Connectors",
    description:
      "Wire GitHub, Slack, and CI into the pipeline with a few lines of config.",
    href: "/#enterprise",
  },
] as const;

function PlatformGlyph({
  label,
}: {
  label: (typeof platformLinks)[number]["label"];
}) {
  if (label === "Control Planes") {
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
          mogplex
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

        <span className="mpx-control-stamp">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          CONTROL&nbsp;PLANE <b>v0.9.14</b>
        </span>
        <Link className="mpx-live-link" href="/#run">
          View a live run
        </Link>
        <GithubPill />
        <Link className="mpx-button is-primary is-small" href="/signup">
          Start building
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
          <Link href="/#run" onClick={() => setMobileOpen(false)}>
            View a live run →
          </Link>
          <GithubPill small />
        </div>
      </nav>
    </header>
  );
}

/* ── theme control ────────────────────────────────────────────── */

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2.2M12 19.8V22M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2 12h2.2M19.8 12H22M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56" />
    </svg>
  );
}

function MoonIcon() {
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
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.6 8.6 0 1 0 20.5 15.2Z" />
    </svg>
  );
}

function SystemIcon() {
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
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </svg>
  );
}

export function ThemeMenu() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );
  const current = mounted ? (theme ?? "system") : "system";
  const resolved = mounted ? (resolvedTheme ?? "light") : "light";

  return (
    <details className="mpx-theme-menu">
      <summary aria-label="Choose color theme" title="Color theme">
        {resolved === "dark" ? <MoonIcon /> : <SunIcon />}
      </summary>
      <div role="menu" aria-label="Color theme">
        <p>COLOR THEME</p>
        {(
          [
            ["light", "Light", <SunIcon key="light" />],
            ["system", "System", <SystemIcon key="system" />],
            ["dark", "Dark", <MoonIcon key="dark" />],
          ] as const
        ).map(([option, label, icon]) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={current === option}
            onClick={(event) => {
              setTheme(option);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            {icon}
            <span>{label}</span>
            <svg
              className="mpx-theme-check"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m5 12.5 4.2 4.2L19 7" />
            </svg>
          </button>
        ))}
      </div>
    </details>
  );
}

/* ── footer ───────────────────────────────────────────────────── */

export function MpxFooter() {
  return (
    <footer className="mpx-footer">
      <div className="mpx-footer-main">
        <div>
          <Link href="/" className="mpx-footer-brand">
            mogplex
          </Link>
          <p>
            The open-source control plane for building, governing, and scaling
            agentic software delivery.
          </p>
          <span className="mpx-system-status">
            <i /> ALL SYSTEMS OPERATIONAL
          </span>
        </div>
        <nav aria-label="Footer navigation">
          <div>
            <b>PLATFORM</b>
            <Link href="/#control-planes">Control planes</Link>
            <Link href="/#harnesses">Harnesses</Link>
            <Link href="/#run">CLI</Link>
            <Link href="/#enterprise">Connectors</Link>
          </div>
          <div>
            <b>ENTERPRISE</b>
            <Link href="/#capabilities">Security</Link>
            <Link href="/#capabilities">Governance</Link>
            <Link href="/#enterprise">Deployment</Link>
            <a href="mailto:enterprise@mogplex.com">Contact sales</a>
          </div>
          <div>
            <b>DEVELOPERS</b>
            <a href="https://docs.mogplex.com">Docs</a>
            <a href="https://docs.mogplex.com/quickstart">Quickstart</a>
            <a href={GITHUB_URL}>GitHub</a>
            <a href={`${GITHUB_URL}/releases`}>Changelog</a>
          </div>
          <div>
            <b>COMPANY</b>
            <Link href="/company">About</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/company">Careers</Link>
            <a href="https://docs.mogplex.com/security">Security</a>
            <a href="https://status.mogplex.com">Status</a>
          </div>
        </nav>
      </div>
      <div className="mpx-footer-bottom">
        <p>© {new Date().getFullYear()} MOGPLEX INC.</p>
        <div>
          <Link href="/privacy">PRIVACY</Link>
          <Link href="/terms">TERMS</Link>
          <a href="https://docs.mogplex.com/security">SECURITY</a>
          <ThemeMenu />
        </div>
      </div>
    </footer>
  );
}
