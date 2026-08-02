"use client";

import { useMemo } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useMemberships } from "@/hooks/use-memberships";
import { useUser } from "@/hooks/use-user";
import { switchScopePath } from "@/lib/scope-switch";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Renders scope-switching rows for embedding inside an existing
// DropdownMenuContent (e.g. the user avatar menu in top-bar.tsx). It
// expects DropdownMenu primitives in scope from the parent.
export function ScopeMenuItems() {
  const router = useRouter();
  const pathname = usePathname();
  const { scope } = useParams<{ scope?: string }>();
  const { user } = useUser();
  const { memberships, isLoading } = useMemberships();

  const personalLabel = useMemo(
    () => memberships.personal.name || user?.github_username || "Personal",
    [memberships.personal.name, user?.github_username]
  );
  const personalActive = Boolean(
    scope && memberships.personal.slug === scope
  );

  const handleSelect = (nextScope: string) => {
    const target = switchScopePath(pathname || "/", scope, nextScope);
    router.push(target);
  };

  return (
    <>
      <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Personal
      </DropdownMenuLabel>
      {memberships.personal.slug ? (
        <DropdownMenuItem
          onSelect={() => handleSelect(memberships.personal.slug!)}
          className="flex items-center gap-2"
        >
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-accent text-[10px] font-medium text-foreground/80"
          >
            {initialsOf(personalLabel)}
          </span>
          <span className="flex-1 truncate">{personalLabel}</span>
          {personalActive && <span className="text-xs">✓</span>}
        </DropdownMenuItem>
      ) : (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {isLoading ? "Loading…" : "No personal slug set"}
        </div>
      )}

      {memberships.teams.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Teams
          </DropdownMenuLabel>
          {memberships.teams.map((team) => {
            const isActive = scope === team.slug;
            return (
              <DropdownMenuItem
                key={team.id}
                onSelect={() => handleSelect(team.slug)}
                className="flex items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-accent text-[10px] font-medium text-foreground/80"
                >
                  {team.iconUrl ? (
                    <img
                      src={team.iconUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initialsOf(team.name)
                  )}
                </span>
                <span className="flex-1 truncate">{team.name}</span>
                {isActive && <span className="text-xs">✓</span>}
              </DropdownMenuItem>
            );
          })}
        </>
      )}

      <DropdownMenuItem onSelect={() => router.push("/new/team")}>
        + Create team
      </DropdownMenuItem>
    </>
  );
}
