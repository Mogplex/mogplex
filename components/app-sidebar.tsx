"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  Cube,
  DeliveryTruck,
  Eye,
  Flash,
  Repository,
  Search,
  SendDiagonal,
  Settings,
  SidebarCollapse,
  SidebarExpand,
} from "iconoir-react";
import { MogplexMark } from "@/components/brand/mogplex-mark";
import {
  buildAppNavItems,
  isAppNavItemActive,
  type AppNavItemId,
} from "@/lib/app-navigation";

const SIDEBAR_WIDTH_KEY = "mogplex.appSidebar.width";
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 64;
const COMPACT_THRESHOLD = 120;
const MAX_WIDTH = 320;

const NAV_ICONS = {
  control: SendDiagonal,
  workspaces: Repository,
  automations: Flash,
  sandboxes: Cube,
  delivery: DeliveryTruck,
  observe: Eye,
  settings: Settings,
} satisfies Record<AppNavItemId, typeof SendDiagonal>;

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

export function AppSidebar() {
  const pathname = usePathname() || "";
  const { scope } = useParams<{ scope: string }>();
  const navItems = useMemo(() => buildAppNavItems(scope), [scope]);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [lastExpandedWidth, setLastExpandedWidth] = useState(DEFAULT_WIDTH);
  const activePointerId = useRef<number | null>(null);
  const compact = width <= COMPACT_THRESHOLD;

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    const frame = window.requestAnimationFrame(() => {
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        const nextWidth = clampWidth(storedWidth);
        setWidth(nextWidth);
        if (nextWidth > COMPACT_THRESHOLD) setLastExpandedWidth(nextWidth);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    const onPointerMove = (event: PointerEvent) => {
      if (
        activePointerId.current !== null &&
        event.pointerId !== activePointerId.current
      ) {
        return;
      }
      const nextWidth = clampWidth(event.clientX);
      setWidth(nextWidth);
      if (nextWidth > COMPACT_THRESHOLD) setLastExpandedWidth(nextWidth);
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
    };
    const stopResizing = () => {
      activePointerId.current = null;
      setResizing(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [resizing]);

  function resizeFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -8 : 8;
    setWidth((current) => {
      const next = clampWidth(current + direction);
      if (next > COMPACT_THRESHOLD) setLastExpandedWidth(next);
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
      return next;
    });
  }

  function toggleCollapsed() {
    const nextWidth = compact ? lastExpandedWidth : MIN_WIDTH;
    setWidth(nextWidth);
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
  }

  return (
    <aside
      className="app-sidebar relative hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex"
      data-compact={compact ? "true" : "false"}
      data-resizing={resizing ? "true" : "false"}
      data-testid="app-sidebar"
      style={{ width }}
    >
      <div className="app-sidebar-header flex h-[76px] shrink-0 items-center overflow-hidden px-5">
        <Link
          href={navItems[0].href}
          aria-label="Mogplex home"
          className="app-sidebar-logo grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"
        >
          <MogplexMark className="size-5" />
        </Link>
        {compact ? null : (
          <div className="app-sidebar-title min-w-0 pl-3">
            <div className="text-[20px] font-semibold tracking-normal">
              mogplex
            </div>
          </div>
        )}
        <button
          type="button"
          aria-label={compact ? "Expand navigation" : "Collapse navigation"}
          title={compact ? "Expand navigation" : "Collapse navigation"}
          onClick={toggleCollapsed}
          className={`ml-auto grid size-7 shrink-0 place-items-center rounded-md text-secondary-foreground transition-colors hover:bg-muted hover:text-sidebar-foreground ${
            compact ? "mx-auto" : ""
          }`}
        >
          {compact ? (
            <SidebarExpand className="size-4" />
          ) : (
            <SidebarCollapse className="size-4" />
          )}
        </button>
      </div>

      {compact ? null : (
        <div className="px-5 pb-5">
          <button
            type="button"
            className="flex h-9 w-full items-center gap-3 rounded-lg border border-border bg-input px-3 text-left text-sm text-muted-foreground transition-colors hover:border-border-dim hover:text-foreground"
          >
            <Search className="size-4" strokeWidth={1.6} />
            <span>Search</span>
          </button>
        </div>
      )}

      <nav
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-4 py-0"
        aria-label="Primary"
      >
        {navItems.map((item) => {
          const Icon = NAV_ICONS[item.id];
          const active = isAppNavItemActive(pathname, item.match);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={compact ? item.label : undefined}
              title={compact ? item.label : undefined}
              data-testid={`app-nav-${item.id}`}
              className={`app-sidebar-link flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                active
                  ? "is-active bg-sidebar-accent text-sidebar-foreground"
                  : "text-secondary-foreground hover:bg-muted hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="size-5 shrink-0" strokeWidth={1.5} />
              {compact ? null : (
                <span className="app-sidebar-link-label truncate">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="app-sidebar-footer mx-5 mb-5 overflow-hidden rounded-lg border border-sidebar-border bg-card px-4 py-4 text-sm">
        {compact ? null : (
          <div className="app-sidebar-footer-label space-y-3">
            <div>
              <div className="font-semibold text-foreground">Pro Plan</div>
              <div className="mt-2 text-xs text-secondary-foreground">
                12.4K / 25K credits
              </div>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-accent">
              <div className="h-full w-1/2 rounded-full bg-primary" />
            </div>
            <a href="#" className="block text-xs text-secondary-foreground hover:text-foreground">
              Upgrade
            </a>
          </div>
        )}
        {compact ? (
          <span className="app-sidebar-footer-dot text-accent-green">●</span>
        ) : null}
      </div>

      <div
        role="separator"
        aria-label="Resize app navigation"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        data-testid="app-sidebar-resizer"
        onKeyDown={resizeFromKeyboard}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_WIDTH));
        }}
        onPointerDown={(event) => {
          activePointerId.current = event.pointerId;
          setResizing(true);
        }}
        className="app-sidebar-resizer absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none outline-none"
      />
    </aside>
  );
}
