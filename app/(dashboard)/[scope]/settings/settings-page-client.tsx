"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import useSWR from "swr"
import { useUser } from "@/hooks/use-user"
import { fetchJsonArray, fetchJsonObject } from "@/lib/client-fetch"
import { ModelsSection } from "@/components/library/models-section"
import { TeamSettingsClient } from "@/components/settings/team-settings-client"
import { TeamsListSection } from "@/components/settings/teams-list-section"
import { BillingSection } from "@/components/settings/billing-section"
import { CliApiKeysSection } from "@/components/settings/cli-api-keys-section"
import { SlackInstallToast } from "@/components/connections/slack-install-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { trackActivation } from "@/lib/activation-tracking"
import type { ScopeContext } from "@/lib/scope-context"

import {
  AccountSection,
  AgentsSettingsSection,
  ApiKeysSection,
  ConnectionsSection,
  type GithubInstallationView,
  type GithubOwnerTarget,
  type SettingsView,
  type SettingsTab,
  type KeysSubTab,
  SETTINGS_TAB_SET,
  KEYS_SUB_TAB_SET,
  LEGACY_HASH_TO_TAB,
} from "./_components"

export function SettingsPageClient({ scope }: { scope: ScopeContext }) {
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

  useEffect(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash.replace(/^#/, "")
    if (!hash) return
    const mapped = LEGACY_HASH_TO_TAB[hash]
    if (!mapped) return
    const params = new URLSearchParams(window.location.search)
    params.set("tab", mapped)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname])

  const { user, isLoading } = useUser()
  const [defaultModel, setDefaultModel] = useState("")
  const [saving, setSaving] = useState(false)
  const [pendingDefaultModel, setPendingDefaultModel] = useState<string | null>(null)
  const [cascadeAutomations, setCascadeAutomations] = useState(true)
  const [defaultModelNotice, setDefaultModelNotice] = useState<string | null>(null)
  const {
    data: settingsData,
    error: settingsError,
    mutate: mutateSettings,
  } = useSWR<SettingsView>(
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

  useEffect(() => {
    if (typeof settingsData?.default_model === "string") {
      setDefaultModel(settingsData.default_model)
    }
  }, [settingsData])

  const savePreference = useCallback(async (
    key: "default_model",
    value: string,
    options?: { updateAutomationModels?: boolean },
  ) => {
    setSaving(true)
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [key]: value,
        ...(options?.updateAutomationModels ? { update_automation_models: true } : {}),
      }),
    })
    if (!response.ok) {
      setSaving(false)
      throw new Error(`Failed to save ${key}`)
    }
    const payload = (await response.json()) as {
      automations?: { drafts_updated: number; versions_published: number; failed: number }
      automation_update_error?: string
    }
    await mutateSettings((current) => ({
      ...(current ?? {}),
      [key]: value,
    }), false)
    setSaving(false)
    return payload
  }, [mutateSettings])

  const saveDefaultModel = useCallback(async (modelId: string, updateAutomationModels: boolean) => {
    const previousModel = defaultModel
    setDefaultModel(modelId)
    setDefaultModelNotice(null)
    try {
      const payload = await savePreference("default_model", modelId, { updateAutomationModels })
      if (payload?.automation_update_error) {
        setDefaultModelNotice(payload.automation_update_error)
      } else if (updateAutomationModels && payload?.automations && payload.automations.failed > 0) {
        setDefaultModelNotice(
          `Default model saved, but ${payload.automations.failed} automation${payload.automations.failed === 1 ? "" : "s"} couldn't be updated.`,
        )
      }
    } catch {
      setDefaultModel(previousModel)
    }
  }, [defaultModel, savePreference])

  const requestDefaultModel = useCallback(async (modelId: string) => {
    setCascadeAutomations(true)
    setPendingDefaultModel(modelId)
  }, [])

  return (
    <div className="min-h-full p-3 space-y-4 md:p-6 md:space-y-6">
      <SlackInstallToast />
      <div>
        <h1 className="ui-page-title">Settings</h1>
        <div className="ui-page-subtitle">Account connections and preferences.</div>
      </div>

      {settingsLoadError && (
        <div className="text-sm text-destructive">{settingsLoadError}</div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4 md:gap-6">
        <ScrollArea className="w-full">
          <TabsList className="h-8 inline-flex w-max bg-transparent p-0 gap-1">
            <TabsTrigger value="account" className="px-3 h-7 text-[13px]">Account</TabsTrigger>
            <TabsTrigger value="teams" className="px-3 h-7 text-[13px]">Teams</TabsTrigger>
            <TabsTrigger value="connections" className="px-3 h-7 text-[13px]">Connections</TabsTrigger>
            <TabsTrigger value="keys" className="px-3 h-7 text-[13px]">Keys &amp; Tokens</TabsTrigger>
            <TabsTrigger value="models" className="px-3 h-7 text-[13px]">Models</TabsTrigger>
            <TabsTrigger value="agents" className="px-3 h-7 text-[13px]">Agents</TabsTrigger>
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
        </TabsContent>

        <TabsContent value="teams" className="mt-0">
          <TeamsListSection />
        </TabsContent>

        <TabsContent value="connections" className="mt-0">
          <ConnectionsSection />
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

        <TabsContent value="models" className="mt-0">
          {defaultModelNotice && (
            <div data-testid="models-default-notice" className="mb-3 text-sm text-destructive">{defaultModelNotice}</div>
          )}
          <ModelsSection
            defaultModel={defaultModel}
            onSetDefault={requestDefaultModel}
            savingDefault={saving}
          />
        </TabsContent>

        <TabsContent value="agents" className="mt-0">
          <AgentsSettingsSection />
        </TabsContent>

        <TabsContent value="billing" className="mt-0">
          <BillingSection embedded />
        </TabsContent>
      </Tabs>

      <Dialog
        open={pendingDefaultModel !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPendingDefaultModel(null)
        }}
      >
        <DialogContent data-testid="models-default-dialog">
          <DialogHeader>
            <DialogTitle>Change default model?</DialogTitle>
            <DialogDescription>
              New chats and automations will use{" "}
              <span className="font-mono text-foreground">{pendingDefaultModel}</span>{" "}
              by default.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2.5 text-sm leading-5 text-foreground">
            <Checkbox
              data-testid="models-default-update-automations"
              checked={cascadeAutomations}
              onCheckedChange={(checked) => setCascadeAutomations(checked === true)}
              className="mt-0.5"
            />
            <span>
              Also switch automations that use the current default
              (<span className="font-mono">{defaultModel}</span>) to the new model.
              Automations where you picked a different model stay as they are.
            </span>
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="models-default-cancel"
              disabled={saving}
              onClick={() => setPendingDefaultModel(null)}
            >
              Cancel
            </Button>
            <Button
              data-testid="models-default-confirm"
              disabled={saving}
              onClick={() => {
                if (!pendingDefaultModel) return
                const modelId = pendingDefaultModel
                setPendingDefaultModel(null)
                void saveDefaultModel(modelId, cascadeAutomations)
              }}
            >
              Set default
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SettingsPageClient
