"use client";

// Theme menu and footer components for marketing chrome.
// Extracted from mpx-chrome.tsx for module size compliance.

import Link from "next/link";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { MoonIcon, SunIcon, SystemIcon } from "./mpx-chrome-icons";
import { GITHUB_URL, SELF_HOSTING_URL } from "./mpx-chrome-constants";

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

export function MpxFooter() {
  return (
    <footer className="mpx-footer">
      <div className="mpx-footer-main">
        <div>
          <Link href="/" className="mpx-footer-brand">
            mogplex
          </Link>
          <p>
            The open-source system that builds and maintains software with
            agents.
          </p>
          <span className="mpx-system-status">
            <i /> APACHE-2.0 · PUBLIC SOURCE
          </span>
        </div>
        <nav aria-label="Footer navigation">
          <div>
            <b>PLATFORM</b>
            <Link href="/#control-planes">Control plane</Link>
            <Link href="/#harnesses">Harnesses</Link>
            <Link href="/#run">CLI</Link>
            <Link href="/#capabilities">Connectors</Link>
          </div>
          <div>
            <b>OPEN SOURCE</b>
            <Link href="/#capabilities">Security</Link>
            <a href={SELF_HOSTING_URL}>Self-hosting</a>
            <a href="https://docs.mogplex.com">Docs</a>
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
            <Link href="/faq">FAQ</Link>
            <a href={`${GITHUB_URL}/security/policy`}>Security</a>
          </div>
        </nav>
      </div>
      <div className="mpx-footer-bottom">
        <p>&copy; {new Date().getFullYear()} MOGPLEX INC.</p>
        <div>
          <Link href="/privacy">PRIVACY</Link>
          <Link href="/terms">TERMS</Link>
          <a href={`${GITHUB_URL}/security/policy`}>SECURITY</a>
          <ThemeMenu />
        </div>
      </div>
    </footer>
  );
}
