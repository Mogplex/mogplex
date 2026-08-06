"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  Activity,
  Folder,
  GitBranch,
  Group,
  Settings,
} from "iconoir-react";
import { MogplexMark } from "@/components/brand/mogplex-mark";
import {
  buildAppNavItems,
  isAppNavItemActive,
  type AppNavItemId,
} from "@/lib/app-navigation";

const SIDEBAR_WIDTH_KEY = "mogplex.appSidebar.width";
const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 56;
const COMPACT_THRESHOLD = 120;
const MAX_WIDTH = 320;

const NAV_ICONS = {
  projects: Folder,
  agents: Group,
  workflows: GitBranch,
  observability: Activity,
  settings: Settings,
} satisfies Record<AppNavItemId, typeof Folder>;

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

export function AppSidebar() {
  const pathname = usePathname() || "";
  const { scope } = useParams<{ scope: string }>();
  const navItems = useMemo(() => buildAppNavItems(scope), [scope]);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const activePointerId = useRef<number | null>(null);
  const compact = width <= COMPACT_THRESHOLD;

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    const frame = window.requestAnimationFrame(() => {
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setWidth(clampWidth(storedWidth));
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
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
      return next;
    });
  }

  return (
    <aside
      className="app-sidebar relative hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex"
      data-compact={compact ? "true" : "false"}
      data-resizing={resizing ? "true" : "false"}
      data-testid="app-sidebar"
      style={{ width }}
    >
      <div className="app-sidebar-header flex h-12 shrink-0 items-center overflow-hidden border-b border-sidebar-border px-3">
        <Link
          href={navItems[0].href}
          aria-label="Mogplex home"
          className="app-sidebar-logo grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"
        >
          <MogplexMark className="size-5" />
        </Link>
        {compact ? null : (
          <div className="app-sidebar-title min-w-0 pl-3">
            <div className="text-[13px] font-semibold tracking-[-0.02em]">
              Mogplex
            </div>
            <div className="font-mono text-[8px] tracking-[0.14em] text-muted-foreground uppercase">
              Foundry
            </div>
          </div>
        )}
      </div>

      <nav
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-2 py-3"
        aria-label="Primary"
      >
        {compact ? null : (
          <div className="app-sidebar-section-label px-2 pb-1 font-mono text-[8px] tracking-[0.16em] text-muted-foreground uppercase">
            Workspace
          </div>
        )}
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
              className={`app-sidebar-link flex h-9 items-center gap-3 rounded-md px-2.5 text-[12px] font-medium transition-colors ${
                active
                  ? "is-active bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="size-[17px] shrink-0" strokeWidth={1.7} />
              {compact ? null : (
                <span className="app-sidebar-link-label truncate">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="app-sidebar-footer overflow-hidden border-t border-sidebar-border px-4 py-3 font-mono text-[8px] tracking-[0.12em] text-muted-foreground uppercase">
        {compact ? null : (
          <span className="app-sidebar-footer-label">
            Agent software foundry · v0.1.0
          </span>
        )}
        <span className="app-sidebar-footer-dot text-accent-green">●</span>
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
