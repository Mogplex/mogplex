"use client";

// Theme menu and footer components for marketing chrome.
// Extracted from mpx-chrome.tsx for module size compliance.

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { MoonIcon, SunIcon, SystemIcon } from "./mpx-chrome-icons";

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
