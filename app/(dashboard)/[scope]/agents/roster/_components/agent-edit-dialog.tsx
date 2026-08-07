"use client";

import type { AIModel } from "@/lib/types";
import {
  MAX_AGENT_DESCRIPTION_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_AGENT_SYSTEM_PROMPT_LENGTH,
} from "@/lib/agents/validation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentDraftAssist } from "@/components/agent-draft-assist";
import type { AgentCategoryRow } from "@/lib/types";

export type CategoryEntry = [
  string,
  { label: string; slug: string; isCustom: boolean },
];

const NEW_CATEGORY_SENTINEL = "__new_category__";

export function AgentEditDialog({
  isOpen,
  isCreating,
  editName,
  setEditName,
  editDescription,
  setEditDescription,
  editPrompt,
  setEditPrompt,
  editCategory,
  setEditCategory,
  saving,
  saveError,
  setSaveError,
  enabledModels,
  modelCatalog,
  defaultModelId,
  builtInCategoryEntries,
  customCategories,
  onClose,
  onSave,
  onOpenNewCategory,
}: {
  isOpen: boolean;
  isCreating: boolean;
  editName: string;
  setEditName: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editPrompt: string;
  setEditPrompt: (v: string) => void;
  editCategory: string;
  setEditCategory: (v: string) => void;
  saving: boolean;
  saveError: string | null;
  setSaveError: (v: string | null) => void;
  enabledModels: AIModel[];
  modelCatalog: AIModel[];
  defaultModelId: string | null;
  builtInCategoryEntries: CategoryEntry[];
  customCategories: AgentCategoryRow[];
  onClose: () => void;
  onSave: () => void;
  onOpenNewCategory: () => void;
}) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] min-h-[80vh] w-[min(94vw,960px)] max-w-none flex-col gap-0 p-0 lg:w-[70vw] lg:max-w-[1100px]">
        <DialogHeader className="shrink-0 px-8 pt-8 pb-6">
          <DialogTitle className="text-xl font-semibold">
            {isCreating ? "New Agent" : "Edit Agent"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {isCreating
              ? "Create a custom agent with one of your enabled models."
              : "Update the agent identity, category, and system prompt in one place."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-8">
          <AgentDraftAssist
            mode={isCreating ? "create" : "edit"}
            enabledModels={enabledModels}
            modelCatalog={modelCatalog}
            defaultModelId={defaultModelId}
            currentDraft={{
              name: editName,
              description: editDescription,
              category: editCategory || null,
              system_prompt: editPrompt,
            }}
            onApplyDraft={(draft) => {
              setEditName(draft.name);
              setEditDescription(draft.description);
              setEditCategory(draft.category);
              setEditPrompt(draft.system_prompt);
              setSaveError(null);
            }}
          />
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="agent-name-input"
                className="text-foreground block text-sm font-medium"
              >
                Name
              </label>
              <input
                id="agent-name-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={MAX_AGENT_NAME_LENGTH}
                className="bg-input border-border text-foreground h-11 w-full rounded-sm border px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <span className="text-foreground block text-sm font-medium">
                Model
              </span>
              <p className="text-muted-foreground text-xs">
                Set per step in the automation that uses this agent, not here.
                The same agent can run on a different model in each automation.
              </p>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="agent-description-input"
                className="text-foreground block text-sm font-medium"
              >
                Description
              </label>
              <input
                id="agent-description-input"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                maxLength={MAX_AGENT_DESCRIPTION_LENGTH}
                className="bg-input border-border text-foreground h-11 w-full rounded-sm border px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="agent-category-select"
                className="text-foreground block text-sm font-medium"
              >
                Category
              </label>
              <select
                id="agent-category-select"
                aria-label="Category"
                value={editCategory}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === NEW_CATEGORY_SENTINEL) {
                    onOpenNewCategory();
                    return;
                  }
                  setEditCategory(next);
                }}
                className="bg-input border-border text-foreground h-11 w-full rounded-sm border px-3 text-sm"
              >
                <option value="" disabled>
                  Select a category
                </option>
                <optgroup label="Built-in">
                  {builtInCategoryEntries.map(([slug, { label }]) => (
                    <option key={slug} value={slug}>
                      {label}
                    </option>
                  ))}
                </optgroup>
                {customCategories.length > 0 && (
                  <optgroup label="Your categories">
                    {customCategories.map((c) => (
                      <option key={c.id} value={c.slug}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={NEW_CATEGORY_SENTINEL}>+ New category...</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="agent-system-prompt-input"
              className="text-foreground block text-sm font-medium"
            >
              System Prompt
            </label>
            <textarea
              id="agent-system-prompt-input"
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              maxLength={MAX_AGENT_SYSTEM_PROMPT_LENGTH}
              className="bg-input border-border text-foreground min-h-[320px] w-full resize-y rounded-sm border px-3 py-2 font-mono text-sm"
            />
          </div>
          {saveError && (
            <div className="text-destructive text-sm">{saveError}</div>
          )}
          <div className="h-2" />
        </div>
        <div className="border-border flex shrink-0 justify-end gap-2 border-t px-8 py-5">
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !editName.trim() || !editCategory}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {saving
              ? isCreating
                ? "Creating..."
                : "Saving..."
              : isCreating
                ? "Create Agent"
                : "Save"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
