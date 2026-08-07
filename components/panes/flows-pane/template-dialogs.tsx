"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PersonalFlowTemplate } from "@/lib/types"

export interface SaveTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  saveTemplateName: string
  onNameChange: (name: string) => void
  saveTemplateScope: "personal" | "team"
  onScopeChange: (scope: "personal" | "team") => void
  savingTemplate: boolean
  onSave: () => void
  activeTeamId: string | null
  teamTemplatesCanWrite: boolean
}

export function SaveTemplateDialog({
  open,
  onOpenChange,
  saveTemplateName,
  onNameChange,
  saveTemplateScope,
  onScopeChange,
  savingTemplate,
  onSave,
  activeTeamId,
  teamTemplatesCanWrite,
}: SaveTemplateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!savingTemplate) onOpenChange(nextOpen)
    }}>
      <DialogContent
        data-testid="flow-save-template-dialog"
        className="overflow-hidden border-border bg-popover p-0 shadow-2xl sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <div className={cn(
            "mb-1 text-[9px] font-semibold tracking-[0.2em] uppercase",
            saveTemplateScope === "team" ? "text-sky-700 dark:text-sky-300/75" : "text-orange-700 dark:text-orange-300/70",
          )}>
            {saveTemplateScope === "team" ? "Team template" : "Personal template"}
          </div>
          <DialogTitle className="text-base text-foreground">
            Save a reusable workflow
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5 text-muted-foreground">
            {saveTemplateScope === "team"
              ? "The graph is shared with your active team. Private agents, GitHub scope, Slack channels, and webhook secrets are removed."
              : "The graph is preserved. GitHub scope, Slack channels, and webhook secrets are removed so every new workflow reconnects safely."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          {activeTeamId && teamTemplatesCanWrite ? (
            <fieldset>
              <legend className="mb-2 block text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                Available to
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="cursor-pointer">
                  <input
                    type="radio"
                    name="flow-template-scope"
                    value="personal"
                    checked={saveTemplateScope === "personal"}
                    onChange={() => onScopeChange("personal")}
                    className="peer sr-only"
                    data-testid="flow-template-scope-personal"
                  />
                  <span className="flex min-h-20 flex-col rounded-lg border border-border bg-foreground/[0.02] px-3 py-2.5 transition-colors peer-checked:border-orange-400/45 peer-checked:bg-orange-400/[0.07]">
                    <span className="text-xs font-semibold text-foreground">Only you</span>
                    <span className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      Keep agent assignments private
                    </span>
                  </span>
                </label>
                <label className="cursor-pointer">
                  <input
                    type="radio"
                    name="flow-template-scope"
                    value="team"
                    checked={saveTemplateScope === "team"}
                    onChange={() => onScopeChange("team")}
                    className="peer sr-only"
                    data-testid="flow-template-scope-team"
                  />
                  <span className="flex min-h-20 flex-col rounded-lg border border-border bg-foreground/[0.02] px-3 py-2.5 transition-colors peer-checked:border-sky-400/45 peer-checked:bg-sky-400/[0.07]">
                    <span className="text-xs font-semibold text-foreground">Active team</span>
                    <span className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      Share the graph, reconnect agents
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          ) : null}
          <label htmlFor="flow-template-name">
            <span className="mb-2 block text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Template name
            </span>
            <Input
              id="flow-template-name"
              value={saveTemplateName}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={80}
              autoFocus
              placeholder="Strict PR review"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  onSave()
                }
              }}
            />
          </label>
        </div>
        <DialogFooter className="border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={savingTemplate}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="flow-save-template-submit"
            disabled={!saveTemplateName.trim() || savingTemplate}
            onClick={onSave}
          >
            {savingTemplate ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface DeleteTemplateDialogProps {
  templateDeleteTarget: {
    template: PersonalFlowTemplate
    scope: "personal" | "team"
  } | null
  onOpenChange: (target: { template: PersonalFlowTemplate; scope: "personal" | "team" } | null) => void
  deletingTemplate: boolean
  onDelete: () => void
}

export function DeleteTemplateDialog({
  templateDeleteTarget,
  onOpenChange,
  deletingTemplate,
  onDelete,
}: DeleteTemplateDialogProps) {
  return (
    <Dialog
      open={Boolean(templateDeleteTarget)}
      onOpenChange={(open) => {
        if (!open && !deletingTemplate) onOpenChange(null)
      }}
    >
      <DialogContent className="overflow-hidden border-border bg-popover p-0 shadow-2xl sm:max-w-sm">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <div className="mb-1 text-[9px] font-semibold tracking-[0.2em] text-red-700 dark:text-red-300/70 uppercase">
            Delete template
          </div>
          <DialogTitle className="text-base text-foreground">
            Remove {templateDeleteTarget?.template.name ?? "this template"}?
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5 text-muted-foreground">
            Existing workflows are unchanged. The template will no longer be
            available from Quick start.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={deletingTemplate}
            onClick={() => onOpenChange(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deletingTemplate}
            onClick={onDelete}
          >
            {deletingTemplate ? "Deleting…" : "Delete template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
