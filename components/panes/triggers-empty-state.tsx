"use client";

import type { AuthUserResponse } from "./triggers-pane-types";

interface TriggersEmptyStateProps {
  installationCount: number;
  syncedRepoCount: number;
  user: AuthUserResponse["user"];
  onCreateClick: () => void;
}

export function TriggersEmptyState({
  installationCount,
  syncedRepoCount,
  user,
  onCreateClick,
}: TriggersEmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        data-testid="triggers-empty-state"
        className="w-full max-w-3xl rounded-lg border border-border bg-secondary/20 p-6 shadow-sm"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-blue/80">
              Automation
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
              Create your first triggered agent
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Triggered agents wake up when something important happens in
              GitHub, like a direct mention, a pull request opening, an issue
              comment, or a failing CI run.
            </p>
          </div>
          <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-4 py-3 text-left md:max-w-xs">
            <div className="text-xs font-medium uppercase tracking-wide text-accent-blue">
              What you need
            </div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              A connected GitHub App installation and at least one agent ready
              to respond.
            </div>
          </div>
        </div>

        {installationCount === 0 && (
          <div className="mt-5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
            <div className="text-sm font-medium text-foreground">
              No GitHub App installations found
            </div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              {syncedRepoCount > 0
                ? `You have ${syncedRepoCount} synced repo${syncedRepoCount === 1 ? "" : "s"}, but triggers only work for repos covered by an installed GitHub App.`
                : "Triggers only work for repos covered by an installed GitHub App."}
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {user?.github_status_detail ||
                (user?.github_connection_mode === "oauth"
                  ? "You are currently connected through GitHub OAuth."
                  : user?.github_connected
                    ? "GitHub is connected, but no app installations are available yet."
                    : "Connect GitHub and install the app to start creating triggers.")}
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            {
              step: "01",
              title: "Choose an installation",
              description:
                "Pick the GitHub account scope where this automation should listen.",
            },
            {
              step: "02",
              title: "Select the event",
              description:
                "Decide what should wake the agent up, from mentions to CI failures.",
            },
            {
              step: "03",
              title: "Assign an agent",
              description:
                "Route the event to the agent that should triage, answer, or take action.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="rounded-lg border border-border bg-card/70 p-4"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {item.step}
              </div>
              <div className="mt-2 text-sm font-medium text-foreground">
                {item.title}
              </div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">
                {item.description}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          {installationCount > 0 ? (
            <button
              onClick={onCreateClick}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Create first trigger
            </button>
          ) : (
            <a
              href={user?.github_primary_action?.href || "/api/auth/github"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {user?.github_primary_action?.label ||
                (user?.github_app_available
                  ? "Install GitHub App"
                  : "Connect GitHub")}
            </a>
          )}
          <div className="text-sm text-muted-foreground">
            {installationCount > 0
              ? `${installationCount} installation${installationCount === 1 ? "" : "s"} available to use`
              : "No GitHub App installations detected yet"}
          </div>
        </div>
      </div>
    </div>
  );
}
