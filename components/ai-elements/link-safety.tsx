"use client";

import { useId, useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const preferenceKey = "mogplex:skip-external-link-confirmation";

function LinkSafetyDialog({ onClose, onConfirm, url }: LinkSafetyModalProps) {
  const checkboxId = useId();
  const [remember, setRemember] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const openLink = () => {
    if (remember) {
      try {
        window.localStorage.setItem(preferenceKey, "true");
      } catch {
        // Storage may be disabled; opening this link must still work.
      }
    }
    onConfirm();
    onClose();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLinkIcon className="size-5" />
            Open external link?
          </DialogTitle>
          <DialogDescription>
            You're about to visit an external website.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted p-3 font-mono text-sm break-all">
          {url}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          <label htmlFor={checkboxId} className="cursor-pointer text-sm">
            Don't show this again
          </label>
        </div>
        {copyError && (
          <p role="alert" className="text-sm text-destructive">
            Could not copy the link. Select and copy the URL above.
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={copyLink}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button className="flex-1" onClick={openLink}>
            <ExternalLinkIcon />
            Open link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const markdownLinkSafety: LinkSafetyConfig = {
  enabled: true,
  onLinkCheck: () => {
    try {
      return window.localStorage.getItem(preferenceKey) === "true";
    } catch {
      return false;
    }
  },
  renderModal: (props) =>
    props.isOpen ? <LinkSafetyDialog {...props} /> : null,
};
