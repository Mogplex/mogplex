"use client";

import Link from "next/link";
import { NavArrowLeft } from "iconoir-react";
import { useParams, usePathname } from "next/navigation";
import { useMemberships } from "@/hooks/use-memberships";
import { buildSettingsNavItems } from "@/lib/settings-navigation";

export function SettingsNavigation({ onBack, onNavigate }: {
  onBack: () => void;
  onNavigate?: () => void;
}) {
  const { scope } = useParams<{ scope: string }>();
  const pathname = usePathname();
  const { memberships, isLoading } = useMemberships();
  const team = memberships.teams.find((item) => item.slug === scope);
  const personal = memberships.personal.slug === scope;
  const items = team || personal
    ? buildSettingsNavItems(scope, team ? "team" : "personal", team?.role === "owner" || team?.role === "admin")
    : [];

  return (
    <nav aria-label="Settings" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4">
      <button type="button" onClick={onBack} aria-label="Back to main navigation from Settings"
        className="mb-3 flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
        <NavArrowLeft className="size-5 shrink-0" aria-hidden="true" />
        Settings
      </button>
      {isLoading && <p className="px-3 text-sm text-muted-foreground" role="status">Loading settings…</p>}
      {!isLoading && items.length === 0 && <p className="px-3 text-sm text-muted-foreground" role="status">Settings navigation is unavailable.</p>}
      {items.map((item) => (
        <Link key={item.id} href={item.href} onClick={onNavigate}
          data-testid={`settings-nav-${item.id}`}
          aria-current={pathname === item.href ? "page" : undefined}
          className={`app-sidebar-link flex min-h-10 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${pathname === item.href ? "is-active bg-sidebar-accent text-sidebar-foreground" : "text-secondary-foreground hover:bg-muted hover:text-sidebar-foreground"}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
