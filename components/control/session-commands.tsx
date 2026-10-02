"use client";

import { CommandGroup, CommandItem } from "@/components/ui/command";
import type { ControlSessionSummary } from "@/lib/control/session-types";

export function SessionCommands({ sessions, error, isLoading, retry, onSelect }: {
  sessions: ControlSessionSummary[];
  error: unknown;
  isLoading: boolean;
  retry: () => void;
  onSelect: (id: string) => void;
}) {
  if (!sessions.length && !error && !isLoading) return null;
  return (
    <CommandGroup heading="Sessions">
      {isLoading && <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">Please wait…</p>}
      {error ? <CommandItem value="retry-control-sessions" onSelect={retry}>Could not load chats. Try again.</CommandItem> : null}
      {sessions.map((session) => (
        <CommandItem key={session.id} value={`session-${session.id}`} onSelect={() => onSelect(session.id)}>
          <span className="flex-1 truncate">{session.title}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
