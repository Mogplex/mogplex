"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { scopedHref } from "@/lib/scoped-href";
import useSWR from "swr";
import { useUser } from "@/hooks/use-user";
import { ScopeMenuItems } from "@/components/scope-switcher";
import { SlackFill } from "@/components/settings/icons";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCommandPalette } from "@/components/command-palette-provider";
import {
  buildAppNavItems,
  isAppNavItemActive,
  type AppNavItem,
} from "@/lib/app-navigation";

const DOCS_URL = "https://docs.mogplex.com/";

type SlackInstallationsResponse = {
  installations: Array<{ teamId: string; teamName: string | null }>;
};

const fetchSlackInstallations = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Slack installations API ${response.status}`);
  return response.json() as Promise<SlackInstallationsResponse>;
};

function MobileNavLink({
  item,
  pathname,
}: {
  item: AppNavItem;
  pathname: string;
}) {
  const isActive = isAppNavItemActive(pathname, item.match);
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={`border-border border-b px-4 py-3 text-sm transition-colors ${
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
      }`}
    >
      {item.label}
    </Link>
  );
}

export function MobileSheetNav({
  primaryItems,
  adminItems,
  pathname,
}: {
  primaryItems: AppNavItem[];
  adminItems: AppNavItem[];
  pathname: string;
}) {
  return (
    <nav className="flex flex-col">
      {primaryItems.map((item) => (
        <MobileNavLink key={item.id} item={item} pathname={pathname} />
      ))}
      {adminItems.length > 0 && (
        <>
          <div className="border-border mt-6 border-t" aria-hidden="true" />
          {adminItems.map((item) => (
            <MobileNavLink key={item.id} item={item} pathname={pathname} />
          ))}
        </>
      )}
    </nav>
  );
}

export function TopBar() {
  const { user, logout, isLoading } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const { scope } = useParams<{ scope: string }>();
  const navItems = useMemo(() => buildAppNavItems(scope), [scope]);
  const primaryItems = navItems.filter((item) => item.section === "primary");
  const adminItems = navItems.filter((item) => item.section === "admin");
  const { open: openCommandPalette } = useCommandPalette();
  const {
    data: slackInstallationsData,
    error: slackInstallationsError,
    isLoading: slackInstallationsLoading,
  } = useSWR<SlackInstallationsResponse>(
    user ? "/api/integrations/slack/installations" : null,
    fetchSlackInstallations
  );
  const slackInstallation = slackInstallationsData?.installations[0] ?? null;
  const slackConnected = Boolean(slackInstallation);
  const slackMenuDisabled =
    slackInstallationsLoading || Boolean(slackInstallationsError);
  const slackTeamLabel =
    slackInstallation?.teamName || slackInstallation?.teamId;
  const slackMenuLabel = slackInstallationsLoading
    ? "Slack"
    : slackInstallationsError
      ? "Slack unavailable"
      : slackTeamLabel
        ? `Connected: ${slackTeamLabel}`
        : "Connect Slack";
  const githubPrimaryAction =
    user?.github_primary_action ||
    (!user?.github_connected
      ? {
          label: user?.github_app_available
            ? "Install GitHub App"
            : "Connect GitHub",
          href: "/api/auth/github",
        }
      : null);

  return (
    <div className="app-topbar flex items-center justify-end gap-2 bg-transparent">
      <Sheet>
        <SheetTrigger asChild>
          <button className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg border px-2 py-1 font-mono text-[10px] tracking-[0.12em] uppercase lg:hidden">
            |||
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-56 p-0 pt-12">
          <MobileSheetNav
            primaryItems={primaryItems}
            adminItems={adminItems}
            pathname={pathname}
          />
        </SheetContent>
      </Sheet>

      <div className="flex h-9 items-center gap-2 lg:gap-3">
        <button
          onClick={openCommandPalette}
          className="app-command-search border-border bg-input text-muted-foreground hover:border-border-dim hover:bg-accent hover:text-foreground hidden h-7 w-[140px] cursor-pointer items-center justify-between rounded-lg border pr-1.5 pl-3 text-[12px] sm:inline-flex lg:w-[180px]"
        >
          Search
          <kbd className="bg-accent text-muted-foreground inline-flex h-5 items-center gap-0.5 rounded-md px-1.5 text-[11px]">
            <span>⌘</span>
            <span>K</span>
          </kbd>
        </button>

        {user &&
          githubPrimaryAction &&
          githubPrimaryAction.href === "/api/auth/github" && (
            <a
              href={githubPrimaryAction.href}
              target="_blank"
              rel="noopener noreferrer"
              className="border-border bg-card text-foreground/72 hover:border-border-dim hover:bg-accent hover:text-foreground hidden h-7 items-center rounded-lg border px-3 font-mono text-[10px] tracking-[0.06em] uppercase sm:inline-flex"
            >
              {githubPrimaryAction.label}
            </a>
          )}

        {isLoading ? (
          <div className="bg-accent h-7 w-20 animate-pulse rounded-lg" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="User menu"
                className="focus:ring-ring rounded-lg outline-none focus:ring-2"
              >
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="ring-border hover:ring-border-dim size-7 rounded-lg ring-1 transition-shadow"
                  />
                ) : (
                  <div className="border-border bg-accent size-7 rounded-lg border" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="mogplex-account-menu w-60"
            >
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-medium">
                  {user.github_username || "User"}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {user.email || ""}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <ScopeMenuItems />
              <DropdownMenuSeparator />
              {slackMenuDisabled ? (
                <DropdownMenuItem disabled>
                  <SlackFill
                    size={16}
                    aria-hidden="true"
                    className="shrink-0"
                  />
                  <span className="truncate">{slackMenuLabel}</span>
                </DropdownMenuItem>
              ) : slackConnected ? (
                <DropdownMenuItem
                  onSelect={() =>
                    router.push(scopedHref(scope, "/settings?tab=connections"))
                  }
                >
                  <SlackFill
                    size={16}
                    aria-hidden="true"
                    className="shrink-0"
                  />
                  <span className="truncate">{slackMenuLabel}</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem asChild>
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth start endpoint, needs full-page navigation */}
                  <a href="/api/integrations/slack/install">
                    <SlackFill
                      size={16}
                      aria-hidden="true"
                      className="shrink-0"
                    />
                    <span className="truncate">{slackMenuLabel}</span>
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => router.push(scopedHref(scope, "/settings"))}
              >
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openCommandPalette}>
                Command Palette
                <span className="text-muted-foreground ml-auto text-xs">
                  ⌘K
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="user-menu-docs"
                >
                  Docs
                  <span className="text-muted-foreground ml-auto text-xs">
                    ↗
                  </span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div
                className="flex items-center justify-center px-2 py-1.5"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  // Only swallow keys that would otherwise close the dropdown
                  // when the user activates a switcher button. Tab, arrow keys,
                  // and Escape continue to bubble so Radix can manage focus
                  // and dismissal.
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                  }
                }}
              >
                <ThemeSwitcher />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={logout}>Logout</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- hard nav so logged-out cookies clear
          <a
            href="/login"
            className="text-muted-foreground hover:text-foreground text-[13px]"
          >
            Reconnect
          </a>
        )}
      </div>
    </div>
  );
}
