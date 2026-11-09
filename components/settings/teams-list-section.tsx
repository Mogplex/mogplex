"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { NavArrowRight } from "iconoir-react"
import { useMemberships } from "@/hooks/use-memberships"
import { ScopeIcon } from "@/components/scope-icon"
import { formatTeamRole } from "@/lib/team-role-label"
import { scopedHref } from "@/lib/scoped-href"

/**
 * Personal Settings → Teams: one row per team. Members, keys, models, and
 * billing are managed on the team's own Settings pages, so this list only
 * links there instead of embedding a second copy of those controls.
 */
export function TeamsListSection() {
  const router = useRouter()
  const { memberships, isLoading, error } = useMemberships()
  const teams = memberships.teams

  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <div className="ui-section-title">Your teams</div>
          <div className="ui-section-caption">
            Open a team to manage its members, keys, models, and billing.
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
          <div className="rounded-lg border border-dashed border-border bg-background/60 p-6 text-center">
            <div className="text-sm text-foreground">No teams yet</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              Create a team to invite collaborators and share resources.
            </div>
          </div>
        )}

        {teams.length > 0 && (
          <ul
            aria-label="Teams"
            className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60"
          >
            {teams.map((team) => (
              <li key={team.id}>
                <Link
                  href={scopedHref(team.slug, "/settings/members")}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/60"
                >
                  <ScopeIcon
                    name={team.name}
                    iconUrl={team.iconUrl}
                    className="h-9 w-9 rounded-md text-[12px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {team.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      /{team.slug}
                    </span>
                  </span>
                  <span className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                    {formatTeamRole(team.role)}
                  </span>
                  <NavArrowRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
