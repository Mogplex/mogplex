"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type CopyableEnvBlockProps = {
  label: string;
  value: string;
};

/** A read-only `.env` block with a copy action. */
export function CopyableEnvBlock({ label, value }: CopyableEnvBlockProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        aria-label={label}
        readOnly
        value={value}
        rows={value.split("\n").length + 1}
        className="font-mono text-xs"
      />
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          Copy
        </Button>
        <span className="text-muted-foreground text-xs" aria-live="polite">
          {copyState === "copied" && "Copied to the clipboard."}
          {copyState === "failed" &&
            "Copy failed. Select the text and copy it manually."}
        </span>
      </div>
    </div>
  );
}
