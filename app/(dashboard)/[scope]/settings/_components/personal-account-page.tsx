"use client"

import { useCallback, useMemo } from "react"
import useSWR from "swr"
import { useUser } from "@/hooks/use-user"
import { fetchJsonArray, fetchJsonObject } from "@/lib/client-fetch"
import { DecisionChecksSection } from "@/components/settings/decision-checks-section"
import { trackActivation } from "@/lib/activation-tracking"
import { AccountSection } from "./account-section"
import type { GithubInstallationView, GithubOwnerTarget, SettingsView } from "./settings-types"

export function PersonalAccountPage() {
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
    <div className="space-y-4 md:space-y-6">
      {settingsLoadError && <div className="text-sm text-destructive">{settingsLoadError}</div>}
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
      <DecisionChecksSection endpoint="/api/settings/decision-checks" audience="personal" />
    </div>
  )
}
