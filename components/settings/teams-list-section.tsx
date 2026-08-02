"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMemberships } from "@/hooks/use-memberships"
import { TeamMembersSection } from "@/components/settings/team-members-section"
import { formatTeamRole } from "@/lib/team-role-label"

function initialsOf(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function TeamsListSection() {
  const router = useRouter()
  const { memberships, isLoading, error } = useMemberships()
  const teams = memberships.teams
  // Teams default to expanded; we only track explicit user collapses.
  const [collapsedTeamIds, setCollapsedTeamIds] = useState<Set<string>>(() => new Set())

  const toggleTeam = (teamId: string) => {
    setCollapsedTeamIds((current) => {
      const next = new Set(current)
      if (next.has(teamId)) {
        next.delete(teamId)
      } else {
        next.add(teamId)
      }
      return next
    })
  }

  return (
    <div className="space-y-4">
      <section className="border border-border/60 bg-card">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
          <div>
            <div className="ui-section-title">Teams</div>
            <div className="ui-section-caption">
              Invite teammates, manage roles, and share keys, models, and connections.
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/new/team")}
            className="shrink-0 border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
          >
            + Create team
          </button>
        </div>

        <div className="px-5 pb-5">
          {error && (
            <div className="text-sm text-destructive">Unable to load teams.</div>
          )}

          {!error && isLoading && teams.length === 0 && (
            <div className="text-sm text-muted-foreground">Loading teams…</div>
          )}

          {!error && !isLoading && teams.length === 0 && (
            <div className="rounded-md border border-dashed border-border bg-background/60 p-6 text-center">
              <div className="text-sm text-foreground">No teams yet</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                Create a team to invite collaborators and share resources.
              </div>
              <button
                type="button"
                onClick={() => router.push("/new/team")}
                className="mt-3 border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
              >
                Create your first team
              </button>
            </div>
          )}

          {teams.length > 0 && (
            <div className="divide-y divide-border/40 border border-border/60">
              {teams.map((team) => {
                const expanded = !collapsedTeamIds.has(team.id)
                const panelId = `team-${team.id}-panel`
                return (
                  <div key={team.id}>
                    <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                      <button
                        type="button"
                        onClick={() => toggleTeam(team.id)}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        className="flex min-w-0 items-center gap-3 text-left hover:opacity-80"
                      >
                        <span aria-hidden="true" className="text-muted-foreground">
                          {expanded ? "▾" : "▸"}
                        </span>
                        <span
                          aria-hidden="true"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-accent text-[11px] font-medium text-foreground/80"
                        >
                          {initialsOf(team.name) || "T"}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {team.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            /{team.slug} · {expanded ? "Hide members" : "Manage members"}
                          </span>
                        </span>
                      </button>
                      <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                        {formatTeamRole(team.role)}
                      </span>
                      <button
                        type="button"
                        onClick={() => router.push(`/${team.slug}/settings`)}
                        className="border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        Open team
                      </button>
                    </div>
                    {expanded && (
                      <div
                        id={panelId}
                        className="border-t border-border/40 bg-background/40 p-3 md:p-4"
                      >
                        <TeamMembersSection teamId={team.id} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
