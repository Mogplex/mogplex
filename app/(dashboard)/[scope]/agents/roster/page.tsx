"use client"
import { useEffect, useState, useMemo, useCallback, useRef, memo, useDeferredValue } from "react"
import { useAgents } from "@/hooks/use-agents"
import { useAgentCategories } from "@/hooks/use-agent-categories"
import { useModels } from "@/hooks/use-models"
import { AGENT_CATEGORIES } from "@/lib/agents/templates"
import { MAX_AGENT_CATEGORY_LABEL_LENGTH } from "@/lib/agents/category-utils"
import { getDefaultNewAgentModel } from "@/lib/agents/model-options"
import {
  MAX_AGENT_DESCRIPTION_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_AGENT_SYSTEM_PROMPT_LENGTH,
  validateAgentInput,
} from "@/lib/agents/validation"
import type { Agent, AgentCategoryRow } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AgentDraftAssist } from "@/components/agent-draft-assist"

type CategoryEntry = [string, { label: string; slug: string; isCustom: boolean }]
const builtInCategoryEntries: CategoryEntry[] = (
  Object.entries(AGENT_CATEGORIES) as [string, { label: string; slug: string }][]
).map(([slug, { label }]) => [slug, { label, slug, isCustom: false }])
const BUILT_IN_CATEGORY_SLUGS = new Set(builtInCategoryEntries.map(([slug]) => slug))
const NEW_CATEGORY_SENTINEL = "__new_category__"

export default function AgentRosterPage() {
  const { agents, isLoading, error, mutate } = useAgents()
  const { categories, mutate: mutateCategories } = useAgentCategories()
  const {
    models: enabledModels,
    catalog: modelCatalog,
    defaultModelId,
  } = useModels()
  const [isCreating, setIsCreating] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [editName, setEditName] = useState("")
  const [editModel, setEditModel] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editPrompt, setEditPrompt] = useState("")
  const [editCategory, setEditCategory] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [newCategoryOpen, setNewCategoryOpen] = useState(false)
  const [newCategoryLabel, setNewCategoryLabel] = useState("")
  const [newCategorySaving, setNewCategorySaving] = useState(false)
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null)
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<AgentCategoryRow | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)

  const allCategoryEntries = useMemo<CategoryEntry[]>(() => {
    const custom: CategoryEntry[] = categories
      .filter(c => !BUILT_IN_CATEGORY_SLUGS.has(c.slug))
      .map(c => [c.slug, { label: c.label, slug: c.slug, isCustom: true }])
    custom.sort((a, b) => a[1].label.localeCompare(b[1].label))
    return [...builtInCategoryEntries, ...custom]
  }, [categories])

  const renderedCategorySlugs = useMemo(
    () => new Set(allCategoryEntries.map(([slug]) => slug)),
    [allCategoryEntries],
  )
  // Mirror the latest Set into a ref so imperative callbacks (e.g. openEdit
  // invoked right after an SWR mutate) cannot close over a stale snapshot.
  const renderedCategorySlugsRef = useRef(renderedCategorySlugs)
  renderedCategorySlugsRef.current = renderedCategorySlugs

  const categoryLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const [slug, { label }] of allCategoryEntries) map.set(slug, label)
    return map
  }, [allCategoryEntries])

  const customCategories = useMemo(
    () => categories.filter(c => !BUILT_IN_CATEGORY_SLUGS.has(c.slug)),
    [categories],
  )

  const { agentsByCategory, uncategorizedCustomAgents } = useMemo(() => {
    const uncategorized: Agent[] = []
    const byCategory = new Map<string, Agent[]>()
    for (const [slug] of allCategoryEntries) {
      byCategory.set(slug, [])
    }
    const q = deferredSearchQuery.trim().toLowerCase()
    const matches = (a: Agent) => {
      if (!q) return true
      if (a.name.toLowerCase().includes(q)) return true
      if (a.description && a.description.toLowerCase().includes(q)) return true
      return false
    }
    for (const a of agents) {
      if (!matches(a)) continue
      if (typeof a.category === "string" && renderedCategorySlugs.has(a.category)) {
        byCategory.get(a.category)!.push(a)
      } else if (!a.is_preset) {
        uncategorized.push(a)
      }
    }
    return {
      agentsByCategory: byCategory,
      uncategorizedCustomAgents: uncategorized,
    }
  }, [agents, allCategoryEntries, renderedCategorySlugs, deferredSearchQuery])
  const isDialogOpen = isCreating || !!editing

  const closeEditor = useCallback(() => {
    setEditing(null)
    setIsCreating(false)
    setSaveError(null)
  }, [])

  useEffect(() => {
    if (!isCreating || editModel || enabledModels.length === 0) return
    setEditModel(getDefaultNewAgentModel(enabledModels, defaultModelId))
  }, [isCreating, editModel, enabledModels, defaultModelId])

  const openEdit = useCallback((agent: Agent) => {
    setIsCreating(false)
    setEditing(agent)
    setEditName(agent.name)
    setEditModel(agent.model)
    setEditDescription(agent.description ?? "")
    setEditPrompt(agent.system_prompt ?? "")
    setEditCategory(
      typeof agent.category === "string" && renderedCategorySlugsRef.current.has(agent.category)
        ? agent.category
        : "",
    )
    setSaveError(null)
  }, [])

  const forkAndEdit = useCallback(async (agent: Agent) => {
    if (agent.has_fork) {
      const existingFork = agents.find(
        a => !a.is_preset && a.source_template === (agent.source_template ?? agent.name)
      )
      if (existingFork) {
        openEdit(existingFork)
        return
      }
    }

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agent.name,
          model: agent.model,
          system_prompt: agent.system_prompt,
          description: agent.description,
          category: agent.category,
          source_template: agent.source_template ?? agent.name,
        }),
      })

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null) as
          | { error?: string }
          | null
        setSaveError(errorBody?.error || "Failed to create customization")
        return
      }

      const forked = await res.json()
      await mutate()
      openEdit(forked)
    } finally {
      setSaving(false)
    }
  }, [agents, mutate, openEdit])

  const saveEdit = useCallback(async () => {
    if (!editing && !isCreating) return
    const validationError = validateAgentInput({
      name: editName,
      description: editDescription,
      category: editCategory || null,
      systemPrompt: editPrompt,
      model: editModel,
      requireName: true,
      requireModel: true,
      requireCategory: true,
    })
    if (validationError) {
      setSaveError(validationError)
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        name: editName,
        model: editModel,
        description: editDescription,
        system_prompt: editPrompt,
        category: editCategory || null,
      }

      const res = await fetch("/api/agents", {
        method: isCreating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isCreating
            ? payload
            : {
                id: editing!.id,
                ...payload,
          }
        ),
      })
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null) as
          | { error?: string }
          | null
        setSaveError(errorBody?.error || "Failed to save agent")
        return
      }
      await mutate()
      closeEditor()
    } catch {
      setSaveError("Network error while saving agent")
    } finally {
      setSaving(false)
    }
  }, [
    editing,
    isCreating,
    editName,
    editModel,
    editDescription,
    editPrompt,
    editCategory,
    mutate,
    closeEditor,
  ])

  const deleteAgent = useCallback(async (id: string) => {
    const res = await fetch(`/api/agents?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    if (res.ok) await mutate()
  }, [mutate])

  const createBlank = useCallback(() => {
    setEditing(null)
    setIsCreating(true)
    setEditName("")
    setEditModel(getDefaultNewAgentModel(enabledModels, defaultModelId))
    setEditDescription("")
    setEditPrompt("")
    setEditCategory("")
    setSaveError(null)
  }, [defaultModelId, enabledModels])


  const openNewCategoryDialog = useCallback(() => {
    setNewCategoryLabel("")
    setNewCategoryError(null)
    setNewCategoryOpen(true)
  }, [])

  const closeNewCategoryDialog = useCallback(() => {
    if (newCategorySaving) return
    setNewCategoryOpen(false)
  }, [newCategorySaving])

  const createCategory = useCallback(async () => {
    const label = newCategoryLabel.trim().replace(/\s+/g, " ")
    if (!label) {
      setNewCategoryError("Category name is required")
      return
    }
    setNewCategorySaving(true)
    setNewCategoryError(null)
    try {
      const res = await fetch("/api/agent-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      })
      const body = (await res.json().catch(() => null)) as
        | AgentCategoryRow
        | { error?: string }
        | null
      if (!res.ok || !body || !("slug" in body)) {
        const message =
          body && "error" in body && typeof body.error === "string"
            ? body.error
            : "Failed to create category"
        setNewCategoryError(message)
        return
      }
      await mutateCategories()
      setEditCategory(body.slug)
      setNewCategoryOpen(false)
    } catch {
      setNewCategoryError("Network error while creating category")
    } finally {
      setNewCategorySaving(false)
    }
  }, [newCategoryLabel, mutateCategories])

  const confirmDeleteCategory = useCallback(async () => {
    if (!categoryToDelete) return
    setDeletingCategoryId(categoryToDelete.id)
    try {
      const res = await fetch(
        `/api/agent-categories?id=${encodeURIComponent(categoryToDelete.id)}`,
        { method: "DELETE" },
      )
      if (!res.ok) return
      await Promise.all([mutateCategories(), mutate()])
      setCategoryToDelete(null)
    } finally {
      setDeletingCategoryId(null)
    }
  }, [categoryToDelete, mutate, mutateCategories])

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search agents by name or description"
          aria-label="Search agents"
          className="flex-1 min-w-[200px] px-3 py-2 bg-input border border-border text-foreground text-sm rounded-sm"
        />
        <button
          onClick={() => setManageCategoriesOpen(true)}
          className="px-3 py-2 border border-border text-foreground text-sm rounded-sm hover:bg-secondary"
        >
          Manage categories
        </button>
        <button
          onClick={createBlank}
          className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded-sm hover:bg-primary/90"
        >
          New Agent
        </button>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive rounded-sm">
          Failed to load agents
        </div>
      )}
      {saveError && !isDialogOpen && (
        <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive rounded-sm">
          {saveError}
        </div>
      )}

      {isLoading && <div className="ui-meta">Loading agents...</div>}

      {!isLoading && (
        <Tabs defaultValue="all">
          <ScrollArea className="w-full">
            <TabsList className="h-8 inline-flex w-max">
              <TabsTrigger value="all" className="px-3 h-7 text-[13px]">
                All ({
                  Array.from(agentsByCategory.values()).reduce((sum, list) => sum + list.length, 0) +
                  uncategorizedCustomAgents.length
                })
              </TabsTrigger>
              {allCategoryEntries.map(([slug, { label }]) => {
                const count = agentsByCategory.get(slug)?.length ?? 0
                return (
                  <TabsTrigger key={slug} value={slug} className="px-3 h-7 text-[13px]">
                    {label} ({count})
                  </TabsTrigger>
                )
              })}
              {uncategorizedCustomAgents.length > 0 && (
                <TabsTrigger value="uncategorized" className="px-3 h-7 text-[13px]">
                  Needs Category ({uncategorizedCustomAgents.length})
                </TabsTrigger>
              )}
            </TabsList>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* All tab — grouped by category */}
          <TabsContent value="all" className="space-y-4 mt-4">
            {allCategoryEntries.map(([slug, { label }]) => {
              const catAgents = agentsByCategory.get(slug) ?? []
              if (catAgents.length === 0) return null
              return (
                <section key={slug} className="space-y-2">
                  <h2 className="ui-kicker">{label}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {catAgents.map(a => (
                      <AgentCard
                        key={a.id}
                        agent={a}
                        categoryLabel={categoryLabelMap.get(a.category ?? "") ?? null}
                        onCustomize={a.is_preset ? () => forkAndEdit(a) : undefined}
                        onEdit={!a.is_preset ? () => openEdit(a) : undefined}
                        onDelete={!a.is_preset ? () => deleteAgent(a.id) : undefined}
                        saving={saving}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
            {uncategorizedCustomAgents.length > 0 && (
              <section className="space-y-2">
                <h2 className="ui-kicker">Needs Category</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {uncategorizedCustomAgents.map(a => (
                    <AgentCard
                      key={a.id}
                      agent={a}
                      categoryLabel={null}
                      onEdit={() => openEdit(a)}
                      onDelete={() => deleteAgent(a.id)}
                    />
                  ))}
                </div>
              </section>
            )}
            {deferredSearchQuery.trim() &&
              Array.from(agentsByCategory.values()).every(list => list.length === 0) &&
              uncategorizedCustomAgents.length === 0 && (
                <div className="ui-meta">No agents match &ldquo;{deferredSearchQuery}&rdquo;.</div>
              )}
          </TabsContent>

          {/* Category tabs */}
          {allCategoryEntries.map(([slug]) => {
            const catAgents = agentsByCategory.get(slug) ?? []
            return (
              <TabsContent key={slug} value={slug} className="mt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {catAgents.map(a => (
                    <AgentCard
                      key={a.id}
                      agent={a}
                      categoryLabel={categoryLabelMap.get(a.category ?? "") ?? null}
                      onCustomize={a.is_preset ? () => forkAndEdit(a) : undefined}
                      onEdit={!a.is_preset ? () => openEdit(a) : undefined}
                      onDelete={!a.is_preset ? () => deleteAgent(a.id) : undefined}
                      saving={saving}
                    />
                  ))}
                </div>
                {catAgents.length === 0 && (
                  <div className="ui-meta">
                    {deferredSearchQuery.trim()
                      ? `No agents in this category match “${deferredSearchQuery}”.`
                      : "No agents in this category yet."}
                  </div>
                )}
              </TabsContent>
            )
          })}
          <TabsContent value="uncategorized" className="mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {uncategorizedCustomAgents.map(a => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  categoryLabel={null}
                  onEdit={() => openEdit(a)}
                  onDelete={() => deleteAgent(a.id)}
                />
              ))}
            </div>
          </TabsContent>

        </Tabs>
      )}

      {/* Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeEditor() }}>
        <DialogContent className="flex flex-col gap-0 p-0 w-[min(94vw,960px)] max-w-none lg:w-[70vw] lg:max-w-[1100px] min-h-[80vh] max-h-[90vh]">
          <DialogHeader className="shrink-0 px-8 pt-8 pb-6">
            <DialogTitle className="text-xl font-semibold">{isCreating ? "New Agent" : "Edit Agent"}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {isCreating
                ? "Create a custom agent with one of your enabled models."
                : "Update the agent identity, category, and system prompt in one place."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-8 space-y-6">
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
                setEditName(draft.name)
                setEditDescription(draft.description)
                setEditCategory(draft.category)
                setEditPrompt(draft.system_prompt)
                setSaveError(null)
              }}
            />
            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="agent-name-input" className="block text-sm font-medium text-foreground">Name</label>
                <input
                  id="agent-name-input"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  maxLength={MAX_AGENT_NAME_LENGTH}
                  className="w-full h-11 px-3 bg-input border border-border text-foreground text-sm rounded-sm"
                />
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-medium text-foreground">Model</span>
                <p className="text-xs text-muted-foreground">
                  Set per step in the automation that uses this agent, not here. The
                  same agent can run on a different model in each automation.
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="agent-description-input" className="block text-sm font-medium text-foreground">Description</label>
                <input
                  id="agent-description-input"
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  maxLength={MAX_AGENT_DESCRIPTION_LENGTH}
                  className="w-full h-11 px-3 bg-input border border-border text-foreground text-sm rounded-sm"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="agent-category-select" className="block text-sm font-medium text-foreground">Category</label>
                <select
                  id="agent-category-select"
                  aria-label="Category"
                  value={editCategory}
                  onChange={e => {
                    const next = e.target.value
                    if (next === NEW_CATEGORY_SENTINEL) {
                      openNewCategoryDialog()
                      return
                    }
                    setEditCategory(next)
                  }}
                  className="w-full h-11 px-3 bg-input border border-border text-foreground text-sm rounded-sm"
                >
                  <option value="" disabled>Select a category</option>
                  <optgroup label="Built-in">
                    {builtInCategoryEntries.map(([slug, { label }]) => (
                      <option key={slug} value={slug}>{label}</option>
                    ))}
                  </optgroup>
                  {customCategories.length > 0 && (
                    <optgroup label="Your categories">
                      {customCategories.map(c => (
                        <option key={c.id} value={c.slug}>{c.label}</option>
                      ))}
                    </optgroup>
                  )}
                  <option value={NEW_CATEGORY_SENTINEL}>+ New category…</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="agent-system-prompt-input" className="block text-sm font-medium text-foreground">System Prompt</label>
              <textarea
                id="agent-system-prompt-input"
                value={editPrompt}
                onChange={e => setEditPrompt(e.target.value)}
                maxLength={MAX_AGENT_SYSTEM_PROMPT_LENGTH}
                className="w-full min-h-[320px] px-3 py-2 bg-input border border-border text-foreground text-sm rounded-sm resize-y font-mono"
              />
            </div>
            {saveError && (
              <div className="text-sm text-destructive">
                {saveError}
              </div>
            )}
            <div className="h-2" />
          </div>
          <div className="shrink-0 flex justify-end gap-2 border-t border-border px-8 py-5">
            <button
              onClick={closeEditor}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              disabled={saving || !editName.trim() || !editModel || !editCategory}
              className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (isCreating ? "Creating..." : "Saving...") : (isCreating ? "Create Agent" : "Save")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New category dialog */}
      <Dialog open={newCategoryOpen} onOpenChange={(open) => { if (!open) closeNewCategoryDialog() }}>
        <DialogContent className="w-[min(94vw,420px)]">
          <DialogHeader>
            <DialogTitle className="text-base">New category</DialogTitle>
            <DialogDescription>
              Create a custom category to group your agents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="new-category-label" className="ui-label block">Name</label>
            <input
              id="new-category-label"
              value={newCategoryLabel}
              onChange={e => setNewCategoryLabel(e.target.value)}
              maxLength={MAX_AGENT_CATEGORY_LABEL_LENGTH}
              placeholder="e.g. Ops"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void createCategory()
                }
              }}
              className="w-full px-3 py-2 bg-input border border-border text-foreground text-sm rounded-sm"
            />
            {newCategoryError && (
              <div className="text-sm text-destructive">{newCategoryError}</div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={closeNewCategoryDialog}
                disabled={newCategorySaving}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={createCategory}
                disabled={newCategorySaving || !newCategoryLabel.trim()}
                className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {newCategorySaving ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage categories dialog */}
      <Dialog open={manageCategoriesOpen} onOpenChange={setManageCategoriesOpen}>
        <DialogContent className="w-[min(94vw,480px)]">
          <DialogHeader>
            <DialogTitle className="text-base">Manage categories</DialogTitle>
            <DialogDescription>
              Add and remove your custom categories. Built-in categories can&apos;t be removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {customCategories.length === 0 ? (
              <div className="ui-meta">You haven&apos;t added any custom categories yet.</div>
            ) : (
              <ul className="divide-y divide-border border border-border rounded-sm">
                {customCategories.map(c => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-foreground truncate">{c.label}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">{c.slug}</div>
                    </div>
                    <button
                      onClick={() => setCategoryToDelete(c)}
                      className="text-sm text-destructive hover:underline shrink-0"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-between gap-2 pt-1">
              <button
                onClick={() => {
                  setManageCategoriesOpen(false)
                  openNewCategoryDialog()
                }}
                className="px-3 py-1.5 border border-border text-foreground text-sm rounded-sm hover:bg-secondary"
              >
                + New category
              </button>
              <button
                onClick={() => setManageCategoriesOpen(false)}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Done
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete category confirmation */}
      <AlertDialog
        open={!!categoryToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingCategoryId) setCategoryToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this category?</AlertDialogTitle>
            <AlertDialogDescription>
              {categoryToDelete
                ? `"${categoryToDelete.label}" will be removed. Any agents using it will move to "Needs Category".`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingCategoryId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmDeleteCategory()
              }}
              disabled={!!deletingCategoryId}
            >
              {deletingCategoryId ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const AgentCard = memo(function AgentCard({
  agent,
  categoryLabel,
  onCustomize,
  onEdit,
  onDelete,
  saving,
}: {
  agent: Agent
  categoryLabel: string | null
  onCustomize?: () => void
  onEdit?: () => void
  onDelete?: () => void
  saving?: boolean
}) {
  const isPreset = agent.is_preset
  const isCustom = !isPreset && !agent.source_template
  const isForked = !isPreset && !!agent.source_template
  const hasFork = isPreset && agent.has_fork
  const needsCategory = !isPreset && !categoryLabel

  return (
    <div className="p-3 bg-card border border-border rounded-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
            {isPreset && !hasFork && <Badge variant="secondary" className="text-[11px] px-1.5 py-0">Default</Badge>}
            {hasFork && <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-primary/40 text-primary">Has customization</Badge>}
            {isCustom && <Badge variant="outline" className="text-[11px] px-1.5 py-0">Custom</Badge>}
            {isForked && <Badge variant="outline" className="text-[11px] px-1.5 py-0">Customized</Badge>}
            {needsCategory && (
              <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-amber-300/30 text-amber-300">
                Needs category
              </Badge>
            )}
            {categoryLabel && <Badge variant="outline" className="text-[11px] px-1.5 py-0 text-muted-foreground">{categoryLabel}</Badge>}
          </div>
          {agent.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{agent.description}</p>
          )}
        </div>
        {!isPreset && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Agent actions" className="px-1 py-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary text-sm shrink-0">···</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {onEdit && <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>Delete</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex items-center justify-end">
        {isPreset && onCustomize && (
          <button
            onClick={onCustomize}
            disabled={saving}
            className="text-sm text-primary hover:underline disabled:opacity-50"
          >
            {hasFork ? "Edit Customization" : "Customize"}
          </button>
        )}
      </div>
    </div>
  )
})
