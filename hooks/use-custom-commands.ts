"use client";
import { useCallback } from "react";
import useSWR from "swr";
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

export function useCustomCommands() {
  const { data: commands = [], mutate } = useSWR<CustomCmd[]>(
    "/api/commands",
    fetcher
  );

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
    (): SlashCommand[] =>
      commands.map((c) => ({
        name: c.name,
        description: c.description,
        execute: (args: string): CommandResult => {
          const output = c.template.replace(/\$ARGS/g, args);
          return { output, action: "custom", payload: c };
        },
      })),
    [commands]
  );

  return { commands, addCommand, asSlashCommands };
}
