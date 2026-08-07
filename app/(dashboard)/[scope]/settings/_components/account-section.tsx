"use client"

import type { GithubInstallationView, GithubOwnerTarget } from "./settings-types"

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
    github_installation_count?: number
    github_synced_repo_count?: number
    github_status_label?: string | null
    github_status_detail?: string | null
  } | null
  githubPrimaryAction: { label: string; href: string } | null
  showGithubAddInstallAction: boolean
  nextStep: NextStep | null
  trackConnectionStart: (provider: "github", source: string) => void
  githubInstallationsLoadError: string | null
  githubInstallations: GithubInstallationView[] | undefined
  ownerTargets: GithubOwnerTarget[]
  ownerTargetsNeedingInstall: GithubOwnerTarget[]
}

export function AccountSection({
  isLoading,
  user,
  githubPrimaryAction,
  showGithubAddInstallAction,
  nextStep,
  trackConnectionStart,
  githubInstallationsLoadError,
  githubInstallations,
  ownerTargets,
  ownerTargetsNeedingInstall,
}: AccountSectionProps) {
  return (
    <section className="border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Account</div>
        <div className="ui-section-caption">GitHub is your account identity. Manage Vercel from the Connections tab.</div>
      </div>
      <div className="px-5 pb-5 space-y-4">
        <div className="grid gap-3">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-foreground">GitHub App coverage</div>
                <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  GitHub determines which repos can sync into Projects and which repos are actually triggerable.
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
            <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
              {user?.github_status_detail || "No GitHub connection yet"}
              {user?.github_username ? ` · ${user.github_username}` : ""}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-full border border-border px-2 py-0.5">
                {user?.github_installation_count ?? 0} installation{user?.github_installation_count === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-border px-2 py-0.5">
                {user?.github_synced_repo_count ?? 0} synced space{user?.github_synced_repo_count === 1 ? "" : "s"}
              </span>
            </div>
            {githubPrimaryAction && !isLoading && (
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={githubPrimaryAction.href}
                  {...(githubPrimaryAction.href === "/api/auth/github" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  onClick={() => {
                    if (githubPrimaryAction?.href === "/api/auth/github") {
                      trackConnectionStart("github", "settings_github_card")
                    }
                  }}
                  data-testid="settings-github-connect"
                  className="inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
                >
                  {githubPrimaryAction.label}
                </a>
                {showGithubAddInstallAction && (
                  <a
                    href="/api/auth/github"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackConnectionStart("github", "settings_github_add_install")}
                    data-testid="settings-github-add-install"
                    className="inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
                  >
                    Add org or personal install
                  </a>
                )}
              </div>
            )}
            {!githubPrimaryAction && showGithubAddInstallAction && !isLoading && (
              <div className="mt-4 space-y-2">
                <a
                  href="/api/auth/github"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackConnectionStart("github", "settings_github_add_install")}
                  data-testid="settings-github-add-install"
                  className="inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
                >
                  Add org or personal install
                </a>
                <div className="text-[11px] leading-5 text-muted-foreground">
                  Re-open the GitHub App installer any time you need coverage for another org or for your personal GitHub account.
                </div>
              </div>
            )}
            {githubInstallationsLoadError && (
              <div className="mt-4 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-300">
                {githubInstallationsLoadError}
              </div>
            )}
            {ownerTargets.length > 0 && (
              <div className="mt-6 space-y-2">
                <div className="ui-kicker">Available accounts</div>
                {ownerTargets.map((target) => {
                  const installed = target.github_installation_id != null

                  return (
                    <div key={`${target.kind}-${target.login}`} className="rounded-lg border border-border bg-card/70 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-foreground">
                            {target.login}
                          </div>
                          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            {target.scope_label} account
                            {installed
                              ? " · GitHub App installed"
                              : " · OAuth can see it, but App coverage is missing"}
                          </div>
                        </div>
                        {installed ? (
                          <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-[11px] text-accent-green">
                            Installed
                          </span>
                        ) : (
                          <a
                            href="/api/auth/github"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => trackConnectionStart("github", "settings_github_owner_install")}
                            className="text-[11px] text-accent-blue hover:underline"
                          >
                            Add in GitHub
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
                {ownerTargetsNeedingInstall.length > 0 && (
                  <div className="text-[11px] leading-5 text-muted-foreground">
                    Accounts marked without App coverage can still appear through OAuth, but PR reviews, triggers, and repo coverage need a GitHub App install for that account.
                  </div>
                )}
              </div>
            )}
            {(githubInstallations?.length || 0) > 0 && (
              <div className="mt-6 space-y-2">
                <div className="ui-kicker">Installed scopes</div>
                {githubInstallations?.map((installation) => (
                  <div key={installation.id} className="rounded-lg border border-border bg-card/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-foreground">
                          {installation.account_login || `Installation ${installation.installation_id}`}
                        </div>
                        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          {installation.scope_label} scope · {installation.synced_repo_count} synced repo{installation.synced_repo_count === 1 ? "" : "s"}
                        </div>
                        {installation.repositories.length > 0 && (
                          <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                            {installation.repositories.slice(0, 3).map((repo) => repo.full_name).join(", ")}
                            {installation.repositories.length > 3 ? ` +${installation.repositories.length - 3} more` : ""}
                          </div>
                        )}
                      </div>
                      {installation.manage_url ? (
                        <a
                          href={installation.manage_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-accent-blue hover:underline"
                        >
                          Manage on GitHub
                        </a>
                      ) : (
                        <div className="text-[11px] text-muted-foreground">
                          Manage in GitHub settings unavailable until installation metadata is refreshed
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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
