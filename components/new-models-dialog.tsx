"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNewModels } from "@/hooks/use-new-models";

export function NewModelsDialog() {
  const { newModels, autoEnable, dismiss, disable } = useNewModels();
  const [busy, setBusy] = useState(false);

  const open = autoEnable && newModels.length > 0;
  const count = newModels.length;

  async function handle(action: "dismiss" | "disable") {
    setBusy(true);
    try {
      await (action === "disable" ? disable() : dismiss());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) void handle("dismiss");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {count === 1
              ? "A new model is ready to use"
              : `${count} new models are ready to use`}
          </DialogTitle>
          <DialogDescription>
            We automatically enabled{" "}
            {count === 1 ? "this model" : "these models"} for you. You can
            disable {count === 1 ? "it" : "any of them"} anytime in Settings →
            Models.
          </DialogDescription>
        </DialogHeader>

        <ul className="my-1 max-h-60 space-y-1 overflow-auto">
          {newModels.map((model) => (
            <li
              key={model.id}
              className="flex items-center justify-between rounded-md border border-border/70 bg-card/70 px-3 py-2 text-sm"
            >
              <span className="font-medium text-foreground">{model.name}</span>
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {model.provider}
              </span>
            </li>
          ))}
        </ul>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void handle("disable")}
            className="text-muted-foreground"
          >
            Stop auto-adding new models
          </Button>
          <Button disabled={busy} onClick={() => void handle("dismiss")}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
