"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { KeyValueEntry } from "./types";
import { createEntry } from "./helpers";

interface KeyValueEditorProps {
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  label: string;
  description: string;
  secretLabel: string;
}

export function KeyValueEditor({
  entries,
  onChange,
  label,
  description,
  secretLabel,
}: KeyValueEditorProps) {
  const updateEntry = (entryId: string, patch: Partial<KeyValueEntry>) => {
    onChange(
      entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry
      )
    );
  };

  const removeEntry = (entryId: string) => {
    onChange(entries.filter((entry) => entry.id !== entryId));
  };

  const addEntry = (isSecret = false) => {
    onChange([...entries, createEntry({ isSecret })]);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {description}
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-[11px] text-muted-foreground">
          No {label.toLowerCase()} configured yet.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const showSavedBadge =
              entry.isSecret &&
              entry.saved &&
              !entry.clearRequested &&
              entry.value.trim().length === 0;

            return (
              <div
                key={entry.id}
                className="rounded-lg border border-border bg-background/50 p-3"
              >
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-center">
                  <Input
                    value={entry.key}
                    onChange={(event) =>
                      updateEntry(entry.id, { key: event.target.value })
                    }
                    placeholder={`${label} name`}
                  />
                  <div className="space-y-2">
                    <Input
                      type={entry.isSecret ? "password" : "text"}
                      value={entry.value}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          value: event.target.value,
                          clearRequested: false,
                        })
                      }
                      placeholder={
                        entry.isSecret
                          ? showSavedBadge
                            ? "Overwrite saved secret"
                            : "Secret value"
                          : "Value"
                      }
                    />
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={entry.isSecret}
                          onCheckedChange={(checked) =>
                            updateEntry(entry.id, {
                              isSecret: checked,
                              value: checked ? "" : entry.value,
                              clearRequested: false,
                            })
                          }
                        />
                        <span>{secretLabel}</span>
                      </div>
                      {showSavedBadge && <Badge variant="outline">Saved</Badge>}
                      {entry.isSecret && entry.saved && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() =>
                            updateEntry(entry.id, {
                              clearRequested: !entry.clearRequested,
                              value: "",
                            })
                          }
                        >
                          {entry.clearRequested
                            ? "Keep saved secret"
                            : "Clear saved secret"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeEntry(entry.id)}
                  >
                    Remove
                  </Button>
                </div>
                {entry.clearRequested && (
                  <p className="mt-2 text-[11px] text-amber-300">
                    This saved secret will be deleted when you save.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => addEntry(false)}
        >
          Add plain {label.toLowerCase()}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => addEntry(true)}
        >
          Add secret {label.toLowerCase()}
        </Button>
      </div>
    </div>
  );
}
