"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "iconoir-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useMemberships } from "@/hooks/use-memberships";
import { useUser } from "@/hooks/use-user";
import { switchScopePath } from "@/lib/scope-switch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ActiveMark({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <span className="ml-auto flex items-center">
      <Check aria-hidden="true" className="size-4" />
      <span className="sr-only">Current project</span>
    </span>
  );
}

export function ScopeMenuItems({
  onScopeSelected,
}: {
  onScopeSelected?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { scope } = useParams<{ scope?: string }>();
  const { user } = useUser();
  const { memberships, isLoading } = useMemberships();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const personalLabel = useMemo(
    () => memberships.personal.name || user?.github_username || "Personal",
    [memberships.personal.name, user?.github_username]
  );
  const personalActive = Boolean(
    scope && memberships.personal.slug === scope
  );
  const activeLabel = personalActive
    ? personalLabel
    : memberships.teams.find((team) => team.slug === scope)?.name ||
      "Select project";

  useEffect(() => {
    if (!open) return;

    const frameId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
  };

  const handleSelect = (nextScope: string) => {
    const target = switchScopePath(pathname || "/", scope, nextScope);
    setOpen(false);
    setSearch("");
    onScopeSelected?.();
    router.push(target);
  };

  const handleCreateTeam = () => {
    setOpen(false);
    setSearch("");
    onScopeSelected?.();
    router.push("/new/team");
  };

  return (
    <DropdownMenuSub open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuSubTrigger className="gap-2">
        <span>Switch project</span>
        <span className="text-muted-foreground ml-auto max-w-24 truncate text-xs">
          {activeLabel}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72 p-0">
        <Command>
          <CommandInput
            ref={searchInputRef}
            aria-label="Search projects"
            placeholder="Search projects..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-64">
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup heading="Personal">
              {memberships.personal.slug ? (
                <CommandItem
                  aria-current={personalActive ? "true" : undefined}
                  value={`personal ${personalLabel} ${memberships.personal.slug}`}
                  onSelect={() => handleSelect(memberships.personal.slug!)}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-accent text-[10px] font-medium text-foreground/80"
                  >
                    {initialsOf(personalLabel)}
                  </span>
                  <span className="flex-1 truncate">{personalLabel}</span>
                  <ActiveMark active={personalActive} />
                </CommandItem>
              ) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {isLoading ? "Loading…" : "No personal project set"}
                </div>
              )}
            </CommandGroup>

            {memberships.teams.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Teams">
                  {memberships.teams.map((team) => {
                    const isActive = scope === team.slug;
                    return (
                      <CommandItem
                        key={team.id}
                        aria-current={isActive ? "true" : undefined}
                        value={`team ${team.name} ${team.slug}`}
                        onSelect={() => handleSelect(team.slug)}
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
                        <ActiveMark active={isActive} />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="create new team" onSelect={handleCreateTeam}>
                + Create team
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
