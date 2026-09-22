"use client"

import { useEffect, useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import useSWR from "swr"
import { useUser } from "@/hooks/use-user"
import { fetchJsonArray, fetchJsonObject } from "@/lib/client-fetch"
import { TeamSettingsClient } from "@/components/settings/team-settings-client"
import { TeamsListSection } from "@/components/settings/teams-list-section"
import { BillingSection } from "@/components/settings/billing-section"
import { DecisionChecksSection } from "@/components/settings/decision-checks-section"
import { CliApiKeysSection } from "@/components/settings/cli-api-keys-section"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { trackActivation } from "@/lib/activation-tracking"
import { getLegacySettingsDestination } from "@/lib/settings-redirect"
import type { ScopeContext } from "@/lib/scope-context"

import {
  AccountSection,
  ApiKeysSection,
  type GithubInstallationView,
  type GithubOwnerTarget,
  type SettingsView,
  type SettingsTab,
  type KeysSubTab,
  SETTINGS_TAB_SET,
  KEYS_SUB_TAB_SET,
} from "./_components"

export function SettingsPageClient({ scope }: { scope: ScopeContext }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const destination = getLegacySettingsDestination(scope, query)
  useEffect(() => {
    const target = getLegacySettingsDestination(scope, query, window.location.hash)
    if (target) router.replace(target, { scroll: false })
  }, [scope, query, router])
  if (destination) return null

  if (scope.kind === "team") {
    return <TeamSettingsClient teamId={scope.teamId} teamSlug={scope.slug} />
  }

  return <PersonalSettingsClient />
}

function PersonalSettingsClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tabParam = searchParams?.get("tab") ?? ""
  const subParam = searchParams?.get("sub") ?? ""
  const activeTab: SettingsTab = SETTINGS_TAB_SET.has(tabParam) ? (tabParam as SettingsTab) : "account"
  const activeSubTab: KeysSubTab = KEYS_SUB_TAB_SET.has(subParam) ? (subParam as KeysSubTab) : "api"

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      params.set("tab", value)
      params.delete("sub")
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const handleSubTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      params.set("tab", "keys")
      params.set("sub", value)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const { user, isLoading } = useUser()
  const { error: settingsError } = useSWR<SettingsView>(
    "/api/settings",
    (url: string) => fetchJsonObject<SettingsView>(url, "Failed to load settings"),
  )
  const settingsLoadError = settingsError ? "Unable to load settings preferences" : null
  const {
    data: githubInstallations,
    error: githubInstallationsError,
  } = useSWR<GithubInstallationView[]>(
    "/api/github/installations",
    (url: string) => fetchJsonArray<GithubInstallationView>(url, "Failed to load GitHub installations"),
  )
  const { data: githubOwnerTargets } = useSWR<GithubOwnerTarget[]>(
    user?.github_connected ? "/api/github/owners" : null,
    (url: string) => fetchJsonArray<GithubOwnerTarget>(url, "Failed to load GitHub accounts"),
  )
  const ownerTargets = githubOwnerTargets ?? []
  const ownerTargetsNeedingInstall = ownerTargets.filter((target) => target.github_installation_id == null)
  const githubInstallationsLoadError = githubInstallationsError ? "Unable to load GitHub App installations" : null
  const platformAccess = user ? user.platform_access : null
  const platformAiEnabled = platformAccess?.allowPlatformAi ?? null

  const githubPrimaryAction = useMemo(() => {
    if (user?.github_primary_action) return user.github_primary_action
    if (!user?.github_connected) {
      return {
        label: user?.github_app_available ? "Install GitHub App" : "Connect GitHub",
        href: "/api/auth/github",
      }
    }
    return null
  }, [user])

  const showGithubAddInstallAction = Boolean(
    user?.github_app_available &&
    user?.github_connected &&
    githubPrimaryAction?.href !== "/api/auth/github",
  )

  const nextStep = useMemo(() => {
    if (githubPrimaryAction) {
      const githubState = user?.github_state
      const title = githubState === "app_installed"
        ? "Sync repositories next"
        : githubState === "app_install_pending"
          ? "Complete the GitHub App install"
          : githubState === "oauth_connected"
            ? "Upgrade GitHub from OAuth to the App"
            : "Install GitHub App next"
      const description = githubState === "app_installed"
        ? "Open Projects and sync the repositories covered by your GitHub App installation into Mogplex."
        : user?.github_status_detail || "GitHub powers repo sync, trigger coverage, and automation."
      return {
        title,
        description,
        href: githubPrimaryAction.href,
        label: githubPrimaryAction.label,
      }
    }

    if (!user?.github_connected) {
      return {
        title: user?.github_app_available ? "Install GitHub App next" : "Connect GitHub next",
        description: "GitHub is required to import repositories and make Open Workspace useful.",
        href: "/api/auth/github",
        label: user?.github_app_available ? "Install GitHub App" : "Connect GitHub",
      }
    }

    return null
  }, [githubPrimaryAction, user])

  const trackConnectionStart = useCallback((provider: "github", source: string) => {
    if (provider === "github") {
      trackActivation("github_connect_started", {
        source,
        connection_mode: user?.github_app_available ? "app" : "oauth",
      })
    }
  }, [user?.github_app_available])

  return (
    <div className="min-h-full w-full max-w-[1488px] p-3 space-y-4 md:p-6 md:space-y-6">
      <div>
        <h1 className="ui-page-title">Settings</h1>
        <div className="ui-page-subtitle">Account preferences, keys, and billing.</div>
      </div>

      {settingsLoadError && (
        <div className="text-sm text-destructive">{settingsLoadError}</div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4 md:gap-6">
        <ScrollArea className="w-full">
          <TabsList className="h-8 inline-flex w-max bg-transparent p-0 gap-1">
            <TabsTrigger value="account" className="px-3 h-7 text-[13px]">Account</TabsTrigger>
            <TabsTrigger value="teams" className="px-3 h-7 text-[13px]">Teams</TabsTrigger>
            <TabsTrigger value="keys" className="px-3 h-7 text-[13px]">Keys &amp; Tokens</TabsTrigger>
            <TabsTrigger value="billing" className="px-3 h-7 text-[13px]">Billing</TabsTrigger>
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <TabsContent value="account" className="mt-0">
          <AccountSection
            isLoading={isLoading}
            user={user}
            githubPrimaryAction={githubPrimaryAction}
            showGithubAddInstallAction={showGithubAddInstallAction}
            nextStep={nextStep}
            trackConnectionStart={trackConnectionStart}
            githubInstallationsLoadError={githubInstallationsLoadError}
            githubInstallations={githubInstallations}
            ownerTargets={ownerTargets}
            ownerTargetsNeedingInstall={ownerTargetsNeedingInstall}
          />
          <div className="mt-4 md:mt-6">
            <DecisionChecksSection endpoint="/api/settings/decision-checks" audience="personal" />
          </div>
        </TabsContent>

        <TabsContent value="teams" className="mt-0">
          <TeamsListSection />
        </TabsContent>

        <TabsContent value="keys" className="mt-0">
          <Tabs value={activeSubTab} onValueChange={handleSubTabChange} className="gap-4">
            <TabsList className="h-8 inline-flex w-max bg-transparent p-0 gap-1">
              <TabsTrigger value="api" className="px-3 h-7 text-[13px]">Provider Keys</TabsTrigger>
              <TabsTrigger value="cli" className="px-3 h-7 text-[13px]">Mogplex Keys</TabsTrigger>
            </TabsList>
            <TabsContent value="api" className="mt-0">
              <ApiKeysSection platformAiEnabled={isLoading ? null : platformAiEnabled} />
            </TabsContent>
            <TabsContent value="cli" className="mt-0">
              <CliApiKeysSection />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="billing" className="mt-0">
          <BillingSection embedded />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default SettingsPageClient
