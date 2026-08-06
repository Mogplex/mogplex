"use client"
import { useMemo } from "react"
import Link from "next/link"
import { useParams, usePathname, useRouter } from "next/navigation"
import { scopedHref } from "@/lib/scoped-href"
import useSWR from "swr"
import { useUser } from "@/hooks/use-user"
import { MogplexMark } from "@/components/brand/mogplex-mark"
import { ScopeMenuItems } from "@/components/scope-switcher"
import { SlackFill } from "@/components/settings/icons"
import { ThemeSwitcher } from "@/components/theme-switcher"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCommandPalette } from "@/components/command-palette-provider"
import { buildAppNavItems, isAppNavItemActive } from "@/lib/app-navigation"

const DOCS_URL = "https://docs.mogplex.com/"

type SlackInstallationsResponse = {
  installations: Array<{ teamId: string; teamName: string | null }>
}

const fetchSlackInstallations = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Slack installations API ${response.status}`)
  return response.json() as Promise<SlackInstallationsResponse>
}

export function TopBar() {
  const { user, logout, isLoading } = useUser()
  const pathname = usePathname()
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()
  const navItems = useMemo(() => buildAppNavItems(scope), [scope])
  const activeNavItem = navItems.find((item) =>
    isAppNavItemActive(pathname, item.match)
  )
  const { open: openCommandPalette } = useCommandPalette()
  const {
    data: slackInstallationsData,
    error: slackInstallationsError,
    isLoading: slackInstallationsLoading,
  } = useSWR<SlackInstallationsResponse>(
    user ? "/api/integrations/slack/installations" : null,
    fetchSlackInstallations
  )
  const slackInstallation = slackInstallationsData?.installations[0] ?? null
  const slackConnected = Boolean(slackInstallation)
  const slackMenuDisabled =
    slackInstallationsLoading || Boolean(slackInstallationsError)
  const slackTeamLabel = slackInstallation?.teamName || slackInstallation?.teamId
  const slackMenuLabel = slackInstallationsLoading
    ? "Slack"
    : slackInstallationsError
      ? "Slack unavailable"
      : slackTeamLabel
        ? `Connected: ${slackTeamLabel}`
        : "Connect Slack"
  const githubPrimaryAction = user?.github_primary_action
    || (!user?.github_connected
      ? {
          label: user?.github_app_available ? "Install GitHub App" : "Connect GitHub",
          href: "/api/auth/github",
        }
      : null)

  return (
    <header className="app-topbar flex h-12 items-center gap-1 border-b border-border bg-card px-3">
      <Link
        href={scopedHref(scope, "/projects/workspace")}
        className="app-brand-mark mr-2 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-brand-accent-hover lg:hidden"
        aria-label="Mogplex home"
      >
        <MogplexMark className="size-5" />
      </Link>

      <Sheet>
          <SheetTrigger asChild>
            <button className="rounded-md border border-border bg-card px-2 py-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase hover:bg-accent hover:text-foreground lg:hidden">
              |||
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-56 p-0 pt-12">
            <nav className="flex flex-col">
              {navItems.map((item) => {
                const isActive = isAppNavItemActive(pathname, item.match)
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`px-4 py-3 text-sm border-b border-border transition-colors ${
                      isActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </SheetContent>
        </Sheet>

      <div className="hidden min-w-0 items-center gap-2 lg:flex">
        <span className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
          Mogplex
        </span>
        <span className="text-border">/</span>
        <span className="truncate text-[12px] font-medium text-foreground">
          {activeNavItem?.label || "Workspace"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2 lg:gap-3">
        <button
          onClick={openCommandPalette}
          className="app-command-search hidden h-8 w-[150px] cursor-pointer items-center justify-between rounded-md border border-border bg-background/60 pl-3 pr-1.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase hover:border-primary/40 hover:bg-accent/70 hover:text-foreground sm:inline-flex lg:w-[200px]"
        >
          Search
          <kbd className="inline-flex items-center gap-0.5 rounded bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
            <span>⌘</span><span>K</span>
          </kbd>
        </button>

        {user && githubPrimaryAction && githubPrimaryAction.href === "/api/auth/github" && (
          <a
            href={githubPrimaryAction.href}
            target="_blank"
            rel="noopener noreferrer"
          className="hidden items-center rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[10px] tracking-[0.06em] text-foreground/72 uppercase hover:border-primary/40 hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            {githubPrimaryAction.label}
          </a>
        )}

        {isLoading ? (
          <div className="h-[26px] w-20 animate-pulse rounded-md bg-accent" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="User menu" className="rounded-md outline-none focus:ring-2 focus:ring-ring">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="h-7 w-7 rounded-md ring-1 ring-border transition-shadow hover:ring-primary/60" />
                ) : (
                  <div className="h-7 w-7 rounded-md border border-border bg-accent" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-medium">{user.github_username || "User"}</div>
                <div className="text-xs text-muted-foreground truncate">{user.email || ""}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <ScopeMenuItems />
              <DropdownMenuSeparator />
              {slackMenuDisabled ? (
                <DropdownMenuItem disabled>
                  <SlackFill size={16} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{slackMenuLabel}</span>
                </DropdownMenuItem>
              ) : slackConnected ? (
                <DropdownMenuItem onSelect={() => router.push(scopedHref(scope, "/settings?tab=connections"))}>
                  <SlackFill size={16} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{slackMenuLabel}</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem asChild>
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth start endpoint, needs full-page navigation */}
                  <a href="/api/integrations/slack/install">
                    <SlackFill size={16} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">{slackMenuLabel}</span>
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => router.push(scopedHref(scope, "/settings"))}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openCommandPalette}>
                Command Palette
                <span className="ml-auto text-xs text-muted-foreground">⌘K</span>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" data-testid="user-menu-docs">
                  Docs
                  <span className="ml-auto text-xs text-muted-foreground">↗</span>
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
                    event.stopPropagation()
                  }
                }}
              >
                <ThemeSwitcher />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={logout}>
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- hard nav so logged-out cookies clear
          <a href="/login" className="text-[13px] text-muted-foreground hover:text-foreground">Reconnect</a>
        )}
      </div>
    </header>
  )
}
