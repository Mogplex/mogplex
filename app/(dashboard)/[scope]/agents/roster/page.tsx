"use client";

import { useState, useDeferredValue } from "react";
import { useAgents } from "@/hooks/use-agents";
import { useAgentCategories } from "@/hooks/use-agent-categories";
import { useModels } from "@/hooks/use-models";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { AgentCard } from "./_components/agent-card";
import { AgentEditDialog } from "./_components/agent-edit-dialog";
import {
  NewCategoryDialog,
  ManageCategoriesDialog,
  DeleteCategoryDialog,
} from "./_components/category-dialogs";
import {
  useCategoryData,
  useAgentsByCategory,
  builtInCategoryEntries,
} from "./_components/roster-hooks";
import { useAgentEditor } from "./_components/use-agent-editor";
import { useCategoryEditor } from "./_components/use-category-editor";

export default function AgentRosterPage() {
  const { agents, isLoading, error, mutate } = useAgents();
  const { categories, mutate: mutateCategories } = useAgentCategories();
  const {
    models: enabledModels,
    catalog: modelCatalog,
    defaultModelId,
  } = useModels();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const {
    allCategoryEntries,
    renderedCategorySlugsRef,
    categoryLabelMap,
    customCategories,
    renderedCategorySlugs,
  } = useCategoryData(categories);

  const { agentsByCategory, uncategorizedCustomAgents } = useAgentsByCategory(
    agents,
    allCategoryEntries,
    renderedCategorySlugs,
    deferredSearchQuery
  );

  const editor = useAgentEditor({
    agents,
    enabledModels,
    defaultModelId,
    renderedCategorySlugsRef,
    mutate,
  });

  const categoryEditor = useCategoryEditor({
    mutate,
    mutateCategories,
    setEditCategory: editor.setEditCategory,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search agents by name or description"
          aria-label="Search agents"
          className="bg-input border-border text-foreground min-w-[200px] flex-1 rounded-sm border px-3 py-2 text-sm"
        />
        <button
          onClick={() => categoryEditor.setManageCategoriesOpen(true)}
          className="border-border text-foreground hover:bg-secondary rounded-sm border px-3 py-2 text-sm"
        >
          Manage categories
        </button>
        <button
          onClick={editor.createBlank}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm px-3 py-2 text-sm"
        >
          New Agent
        </button>
      </div>

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-sm border px-3 py-2 text-sm">
          Failed to load agents
        </div>
      )}
      {editor.saveError && !editor.isDialogOpen && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-sm border px-3 py-2 text-sm">
          {editor.saveError}
        </div>
      )}

      {isLoading && <div className="ui-meta">Loading agents...</div>}

      {!isLoading && (
        <Tabs defaultValue="all">
          <ScrollArea className="w-full">
            <TabsList className="inline-flex h-8 w-max">
              <TabsTrigger value="all" className="h-7 px-3 text-[13px]">
                All (
                {Array.from(agentsByCategory.values()).reduce(
                  (sum, list) => sum + list.length,
                  0
                ) + uncategorizedCustomAgents.length}
                )
              </TabsTrigger>
              {allCategoryEntries.map(([slug, { label }]) => {
                const count = agentsByCategory.get(slug)?.length ?? 0;
                return (
                  <TabsTrigger
                    key={slug}
                    value={slug}
                    className="h-7 px-3 text-[13px]"
                  >
                    {label} ({count})
                  </TabsTrigger>
                );
              })}
              {uncategorizedCustomAgents.length > 0 && (
                <TabsTrigger
                  value="uncategorized"
                  className="h-7 px-3 text-[13px]"
                >
                  Needs Category ({uncategorizedCustomAgents.length})
                </TabsTrigger>
              )}
            </TabsList>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          <TabsContent value="all" className="mt-4 space-y-4">
            {allCategoryEntries.map(([slug, { label }]) => {
              const catAgents = agentsByCategory.get(slug) ?? [];
              if (catAgents.length === 0) return null;
              return (
                <section key={slug} className="space-y-2">
                  <h2 className="ui-kicker">{label}</h2>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {catAgents.map((a) => (
                      <AgentCard
                        key={a.id}
                        agent={a}
                        categoryLabel={
                          categoryLabelMap.get(a.category ?? "") ?? null
                        }
                        onCustomize={
                          a.is_preset ? () => editor.forkAndEdit(a) : undefined
                        }
                        onEdit={
                          !a.is_preset ? () => editor.openEdit(a) : undefined
                        }
                        onDelete={
                          !a.is_preset
                            ? () => editor.deleteAgent(a.id)
                            : undefined
                        }
                        saving={editor.saving}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            {uncategorizedCustomAgents.length > 0 && (
              <section className="space-y-2">
                <h2 className="ui-kicker">Needs Category</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {uncategorizedCustomAgents.map((a) => (
                    <AgentCard
                      key={a.id}
                      agent={a}
                      categoryLabel={null}
                      onEdit={() => editor.openEdit(a)}
                      onDelete={() => editor.deleteAgent(a.id)}
                    />
                  ))}
                </div>
              </section>
            )}
            {deferredSearchQuery.trim() &&
              Array.from(agentsByCategory.values()).every(
                (list) => list.length === 0
              ) &&
              uncategorizedCustomAgents.length === 0 && (
                <div className="ui-meta">
                  No agents match &ldquo;{deferredSearchQuery}&rdquo;.
                </div>
              )}
          </TabsContent>

          {allCategoryEntries.map(([slug]) => {
            const catAgents = agentsByCategory.get(slug) ?? [];
            return (
              <TabsContent key={slug} value={slug} className="mt-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {catAgents.map((a) => (
                    <AgentCard
                      key={a.id}
                      agent={a}
                      categoryLabel={
                        categoryLabelMap.get(a.category ?? "") ?? null
                      }
                      onCustomize={
                        a.is_preset ? () => editor.forkAndEdit(a) : undefined
                      }
                      onEdit={
                        !a.is_preset ? () => editor.openEdit(a) : undefined
                      }
                      onDelete={
                        !a.is_preset
                          ? () => editor.deleteAgent(a.id)
                          : undefined
                      }
                      saving={editor.saving}
                    />
                  ))}
                </div>
                {catAgents.length === 0 && (
                  <div className="ui-meta">
                    {deferredSearchQuery.trim()
                      ? `No agents in this category match "${deferredSearchQuery}".`
                      : "No agents in this category yet."}
                  </div>
                )}
              </TabsContent>
            );
          })}
          <TabsContent value="uncategorized" className="mt-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {uncategorizedCustomAgents.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  categoryLabel={null}
                  onEdit={() => editor.openEdit(a)}
                  onDelete={() => editor.deleteAgent(a.id)}
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <AgentEditDialog
        isOpen={editor.isDialogOpen}
        isCreating={editor.isCreating}
        editName={editor.editName}
        setEditName={editor.setEditName}
        editDescription={editor.editDescription}
        setEditDescription={editor.setEditDescription}
        editPrompt={editor.editPrompt}
        setEditPrompt={editor.setEditPrompt}
        editCategory={editor.editCategory}
        setEditCategory={editor.setEditCategory}
        saving={editor.saving}
        saveError={editor.saveError}
        setSaveError={editor.setSaveError}
        enabledModels={enabledModels}
        modelCatalog={modelCatalog}
        defaultModelId={defaultModelId}
        builtInCategoryEntries={builtInCategoryEntries}
        customCategories={customCategories}
        onClose={editor.closeEditor}
        onSave={editor.saveEdit}
        onOpenNewCategory={categoryEditor.openNewCategoryDialog}
      />

      <NewCategoryDialog
        open={categoryEditor.newCategoryOpen}
        label={categoryEditor.newCategoryLabel}
        setLabel={categoryEditor.setNewCategoryLabel}
        saving={categoryEditor.newCategorySaving}
        error={categoryEditor.newCategoryError}
        onClose={categoryEditor.closeNewCategoryDialog}
        onCreate={categoryEditor.createCategory}
      />

      <ManageCategoriesDialog
        open={categoryEditor.manageCategoriesOpen}
        setOpen={categoryEditor.setManageCategoriesOpen}
        customCategories={customCategories}
        onDelete={categoryEditor.setCategoryToDelete}
        onNewCategory={categoryEditor.openNewCategoryDialog}
      />

      <DeleteCategoryDialog
        category={categoryEditor.categoryToDelete}
        deleting={!!categoryEditor.deletingCategoryId}
        onCancel={() => categoryEditor.setCategoryToDelete(null)}
        onConfirm={categoryEditor.confirmDeleteCategory}
      />
    </div>
  );
}
