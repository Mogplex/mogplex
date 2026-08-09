"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import useSWR from "swr";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { useMemberships } from "@/hooks/use-memberships";
import {
  ArrowUpCircle,
  Binocular,
  Coins,
  Cube,
  DeliveryTruck,
  Flash,
  Repository,
  Rocket,
  Search,
  Settings,
} from "iconoir-react";
import {
  buildAppNavItems,
  isAppNavItemActive,
  type AppNavItemId,
} from "@/lib/app-navigation";
import { formatUsd } from "@/lib/billing/catalog";
import { scopedHref } from "@/lib/scoped-href";

const SIDEBAR_WIDTH_KEY = "mogplex.appSidebar.width";
const SIDEBAR_COLLAPSED_KEY = "mogplex.appSidebar.collapsed";
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 64;
const COMPACT_THRESHOLD = 120;
const MAX_WIDTH = 320;

const NAV_ICONS = {
  control: Rocket,
  workspaces: Repository,
  automations: Flash,
  sandboxes: Cube,
  delivery: DeliveryTruck,
  observe: Binocular,
  settings: Settings,
} satisfies Record<AppNavItemId, typeof Rocket>;

type BillingSummary = {
  enabled: boolean;
  canManageBilling?: boolean;
  tier?: "free" | "pro" | "team" | "business";
  status?: "active" | "past_due" | "frozen_topups";
  balance?: {
    includedCents: number;
    purchasedCents: number;
    totalCents: number;
  };
};

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

function planName(tier: BillingSummary["tier"]): string {
  if (tier === "pro") return "Pro Plan";
  if (tier === "team") return "Team Plan";
  if (tier === "business") return "Mog Mode";
  return "Pay as you go";
}

function formatCreditSummary(summary: BillingSummary | undefined): string {
  if (!summary?.enabled) return "Billing unavailable";
  const balance = summary.balance;
  if (!balance) return "Balance loading";

  const total = formatUsd(balance.totalCents);
  if (balance.includedCents > 0) {
    return `${total} / ${formatUsd(balance.includedCents)} included`;
  }
  return `${total} available`;
}

function usageMeterWidth(summary: BillingSummary | undefined): string {
  const balance = summary?.balance;
  if (!summary?.enabled || !balance || balance.includedCents <= 0) {
    return "0%";
  }
  const percent = Math.max(
    0,
    Math.min(100, (balance.totalCents / balance.includedCents) * 100)
  );
  return `${percent}%`;
}

type AppNavItem = ReturnType<typeof buildAppNavItems>[number];

function SidebarNavLink({
  item,
  compact,
  pathname,
}: {
  item: AppNavItem;
  compact: boolean;
  pathname: string;
}) {
  const Icon = NAV_ICONS[item.id];
  const active = isAppNavItemActive(pathname, item.match);
  return (
    <Link
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
        <span className="app-sidebar-link-label truncate">{item.label}</span>
      )}
    </Link>
  );
}

async function loadBillingSummary([
  url,
  activeTeamId,
]: [string, string | null]): Promise<BillingSummary> {
  const response = await fetch(url, {
    headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
  });
  if (!response.ok) throw new Error("Failed to load billing summary");
  return (await response.json()) as BillingSummary;
}

export function AppSidebar() {
  const pathname = usePathname() || "";
  const { scope } = useParams<{ scope: string }>();
  const providedActiveTeamId = useActiveTeamId();
  const { memberships, isLoading: membershipsLoading } = useMemberships();
  const routeTeam = useMemo(
    () => memberships.teams.find((team) => team.slug === scope) ?? null,
    [memberships.teams, scope]
  );
  const routeIsPersonalScope = memberships.personal.slug === scope;
  const activeBillingTeamId = useMemo(() => {
    if (providedActiveTeamId) return providedActiveTeamId;
    return routeTeam?.id ?? null;
  }, [providedActiveTeamId, routeTeam]);
  const navItems = useMemo(() => buildAppNavItems(scope), [scope]);
  const primaryItems = navItems.filter((item) => item.section === "primary");
  const adminItems = navItems.filter((item) => item.section === "admin");
  // Only fetch billing once the route scope resolves to the personal account
  // or a known membership — an unknown team slug must not fall back to
  // personal-scope billing.
  const scopeResolved =
    Boolean(providedActiveTeamId) || routeIsPersonalScope || Boolean(routeTeam);
  const shouldLoadBilling =
    Boolean(scope) && !membershipsLoading && scopeResolved;
  const { data: billingSummary, error: billingError, isLoading: billingLoading } =
    useSWR<BillingSummary>(
      shouldLoadBilling ? ["/api/billing", activeBillingTeamId] : null,
      loadBillingSummary
    );
  const showBillingCard =
    Boolean(scope) && (membershipsLoading || scopeResolved);
  const billingPending = membershipsLoading || billingLoading;
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const activePointerId = useRef<number | null>(null);
  const compact = width <= COMPACT_THRESHOLD;

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    const storedCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    const frame = window.requestAnimationFrame(() => {
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        const nextWidth = clampWidth(storedWidth);
        setWidth(storedCollapsed === "true" ? MIN_WIDTH : nextWidth);
      } else if (storedCollapsed === "true") {
        setWidth(MIN_WIDTH);
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
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "false");
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
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "false");
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
      <div className="app-sidebar-header h-[20px] shrink-0" aria-hidden="true" />

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
        {primaryItems.map((item) => (
          <SidebarNavLink
            key={item.id}
            item={item}
            compact={compact}
            pathname={pathname}
          />
        ))}
      </nav>

      <nav
        className="mb-2 flex flex-col gap-1 border-t border-sidebar-border px-4 pt-2"
        aria-label="Admin"
      >
        {adminItems.map((item) => (
          <SidebarNavLink
            key={item.id}
            item={item}
            compact={compact}
            pathname={pathname}
          />
        ))}
      </nav>

      {compact || showBillingCard ? (
        <div className="app-sidebar-footer mx-5 mb-5 overflow-hidden rounded-lg border border-sidebar-border bg-card px-4 py-4 text-sm">
          {compact ? null : (
            <div className="app-sidebar-footer-label space-y-3">
              <div>
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Coins className="size-4 shrink-0" strokeWidth={1.5} />
                  {billingPending
                    ? "Plan loading"
                    : billingError
                      ? "Billing"
                      : planName(billingSummary?.tier)}
                </div>
                <div className="mt-2 text-xs text-secondary-foreground">
                  {billingPending
                    ? "Balance loading"
                    : billingError
                      ? "Summary unavailable"
                      : formatCreditSummary(billingSummary)}
                </div>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-accent">
                <div
                  className="h-full rounded-full bg-foreground/70"
                  style={{ width: usageMeterWidth(billingSummary) }}
                />
              </div>
              <Link
                href={scopedHref(scope, "/settings/billing")}
                className="flex items-center gap-1.5 text-xs text-secondary-foreground hover:text-foreground"
              >
                <ArrowUpCircle className="size-3.5 shrink-0" strokeWidth={1.5} />
                {billingSummary?.canManageBilling === false
                  ? "View billing"
                  : "Manage billing"}
              </Link>
            </div>
          )}
          {compact ? (
            <span className="app-sidebar-footer-dot text-accent-green">●</span>
          ) : null}
        </div>
      ) : null}

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
