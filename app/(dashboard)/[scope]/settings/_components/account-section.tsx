"use client"

import type { GithubAccountRow } from "@/lib/github-account-rows"

type NextStep = {
  title: string
  description: string
  href: string
  label: string
}

type AccountSectionProps = {
  isLoading: boolean
  user: {
    github_state?: string | null
    github_connected?: boolean
    github_username?: string | null
    github_status_label?: string | null
    github_status_detail?: string | null
  } | null
  githubPrimaryAction: { label: string; href: string } | null
  showGithubAddInstallAction: boolean
  nextStep: NextStep | null
  trackConnectionStart: (provider: "github", source: string) => void
  githubInstallationsLoadError: string | null
  githubAccounts: GithubAccountRow[]
}

const BUTTON_CLASS =
  "inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"

function GithubAccountItem({
  account,
  trackConnectionStart,
}: {
  account: GithubAccountRow
  trackConnectionStart: AccountSectionProps["trackConnectionStart"]
}) {
  const { connection } = account
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-3" data-testid="settings-github-account">
      <div className="min-w-0">
        <div className="text-sm text-foreground">{account.login}</div>
        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {account.kind}
          {connection
            ? ` · ${connection.syncedRepoCount} repo${connection.syncedRepoCount === 1 ? "" : "s"} in Mogplex`
            : " · Not connected"}
        </div>
        {connection && connection.repoPreview.length > 0 && (
          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {connection.repoPreview.join(", ")}
            {connection.moreRepoCount > 0 ? ` +${connection.moreRepoCount} more` : ""}
          </div>
        )}
      </div>
      {!connection && (
        <a
          href="/api/auth/github"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackConnectionStart("github", "settings_github_owner_install")}
          className="text-[11px] text-accent-blue hover:underline"
        >
          Connect
        </a>
      )}
      {connection?.manageUrl && (
        <a
          href={connection.manageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-accent-blue hover:underline"
        >
          Manage on GitHub
        </a>
      )}
      {connection && !connection.manageUrl && (
        <div className="text-[11px] text-muted-foreground">
          Manage in GitHub settings unavailable until installation metadata is refreshed
        </div>
      )}
    </li>
  )
}

export function AccountSection({
  isLoading,
  user,
  githubPrimaryAction,
  showGithubAddInstallAction,
  nextStep,
  trackConnectionStart,
  githubInstallationsLoadError,
  githubAccounts,
}: AccountSectionProps) {
  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
        <div>
          <div className="ui-section-title">GitHub</div>
          <div className="ui-section-caption">
            Mogplex works on repositories in the GitHub accounts connected here. To connect an
            account, install the Mogplex app on it. Only an owner can connect an organization.
          </div>
        </div>
        <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${
          user?.github_state === "app_installed_with_synced_repos"
            ? "bg-accent-green/10 text-accent-green"
            : user?.github_connected
              ? "bg-amber-400/10 text-amber-300"
              : "bg-secondary text-muted-foreground"
        }`}>
          {user?.github_status_label || (isLoading ? "Loading..." : "Required")}
        </span>
      </div>
      <div className="space-y-4 px-5 pb-5">
        <div className="text-[11px] leading-5 text-muted-foreground">
          {user?.github_status_detail || "No GitHub connection yet"}
          {user?.github_username ? ` · Signed in as ${user.github_username}` : ""}
        </div>

        {githubAccounts.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card/70" aria-label="GitHub accounts">
            {githubAccounts.map((account) => (
              <GithubAccountItem key={account.key} account={account} trackConnectionStart={trackConnectionStart} />
            ))}
          </ul>
        )}

        {githubInstallationsLoadError && (
          <div className="rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-300">
            {githubInstallationsLoadError}
          </div>
        )}

        {!isLoading && (githubPrimaryAction || showGithubAddInstallAction) && (
          <div className="flex flex-wrap gap-2">
            {githubPrimaryAction && (
              <a
                href={githubPrimaryAction.href}
                {...(githubPrimaryAction.href === "/api/auth/github" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onClick={() => {
                  if (githubPrimaryAction.href === "/api/auth/github") {
                    trackConnectionStart("github", "settings_github_card")
                  }
                }}
                data-testid="settings-github-connect"
                className={BUTTON_CLASS}
              >
                {githubPrimaryAction.label}
              </a>
            )}
            {showGithubAddInstallAction && (
              <a
                href="/api/auth/github"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackConnectionStart("github", "settings_github_add_install")}
                data-testid="settings-github-add-install"
                className={BUTTON_CLASS}
              >
                Connect another account
              </a>
            )}
          </div>
        )}

        {nextStep && (
          <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-4 py-3">
            <div className="text-sm font-medium text-foreground">{nextStep.title}</div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{nextStep.description}</div>
            <a
              href={nextStep.href}
              onClick={() => {
                if (nextStep.href === "/api/auth/github") {
                  trackConnectionStart("github", "settings_next_step")
                }
              }}
              className="mt-3 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {nextStep.label}
            </a>
          </div>
        )}
      </div>
    </section>
  )
}
