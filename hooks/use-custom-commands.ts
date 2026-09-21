"use client";
import { useCallback } from "react";
import useSWR from "swr";
import { useSkillSlashCommands } from "@/hooks/use-skill-catalog";
import type { SlashCommand, CommandResult } from "@/lib/slash-commands";

export type CustomCmd = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  template: string;
};

const fetcher = (url: string) =>
  fetch(url).then((res) => (res.ok ? res.json() : []));

/**
 * Commands the user brings to a composer: their saved templates, then their
 * skills (narrowed by the open repo). A template wins a name it shares with
 * a skill, the same way a built-in wins over both.
 */
export function useCustomCommands(repoId?: string | null) {
  const { data: commands = [], mutate } = useSWR<CustomCmd[]>(
    "/api/commands",
    fetcher
  );
  const skillCommands = useSkillSlashCommands(repoId);

  const addCommand = useCallback(
    async (name: string, description: string, template: string) => {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, template }),
      });
      if (res.ok) {
        await mutate();
      }
    },
    [mutate]
  );

  const asSlashCommands = useCallback(
    (): SlashCommand[] => [
      ...commands.map((c) => ({
        name: c.name,
        description: c.description,
        execute: (args: string): CommandResult => {
          const output = c.template.replace(/\$ARGS/g, args);
          return { output, action: "custom" as const, payload: c };
        },
      })),
      ...skillCommands,
    ],
    [commands, skillCommands]
  );

  return { commands, addCommand, asSlashCommands };
}
