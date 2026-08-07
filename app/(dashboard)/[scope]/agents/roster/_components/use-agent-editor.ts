"use client";

import { useEffect, useState, useCallback } from "react";
import type { Agent, AIModel } from "@/lib/types";
import { getDefaultNewAgentModel } from "@/lib/agents/model-options";
import { validateAgentInput } from "@/lib/agents/validation";

export function useAgentEditor({
  agents,
  enabledModels,
  defaultModelId,
  renderedCategorySlugsRef,
  mutate,
}: {
  agents: Agent[];
  enabledModels: AIModel[];
  defaultModelId: string | null;
  renderedCategorySlugsRef: React.MutableRefObject<Set<string>>;
  mutate: () => Promise<unknown>;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [editName, setEditName] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDialogOpen = isCreating || Boolean(editing);

  useEffect(() => {
    if (!isCreating || editModel || enabledModels.length === 0) return;
    setEditModel(getDefaultNewAgentModel(enabledModels, defaultModelId));
  }, [isCreating, editModel, enabledModels, defaultModelId]);

  const closeEditor = useCallback(() => {
    setEditing(null);
    setIsCreating(false);
    setSaveError(null);
  }, []);

  const openEdit = useCallback(
    (agent: Agent) => {
      setIsCreating(false);
      setEditing(agent);
      setEditName(agent.name);
      setEditModel(agent.model);
      setEditDescription(agent.description ?? "");
      setEditPrompt(agent.system_prompt ?? "");
      setEditCategory(
        typeof agent.category === "string" &&
          renderedCategorySlugsRef.current.has(agent.category)
          ? agent.category
          : ""
      );
      setSaveError(null);
    },
    [renderedCategorySlugsRef]
  );

  const forkAndEdit = useCallback(
    async (agent: Agent) => {
      if (agent.has_fork) {
        const existingFork = agents.find(
          (a) =>
            !a.is_preset &&
            a.source_template === (agent.source_template ?? agent.name)
        );
        if (existingFork) {
          openEdit(existingFork);
          return;
        }
      }

      setSaving(true);
      setSaveError(null);
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
        });

        if (!res.ok) {
          const errorBody = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setSaveError(errorBody?.error || "Failed to create customization");
          return;
        }

        const forked = await res.json();
        await mutate();
        openEdit(forked);
      } finally {
        setSaving(false);
      }
    },
    [agents, mutate, openEdit]
  );

  const saveEdit = useCallback(async () => {
    if (!editing && !isCreating) return;
    const validationError = validateAgentInput({
      name: editName,
      description: editDescription,
      category: editCategory || null,
      systemPrompt: editPrompt,
      model: editModel,
      requireName: true,
      requireModel: true,
      requireCategory: true,
    });
    if (validationError) {
      setSaveError(validationError);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name: editName,
        model: editModel,
        description: editDescription,
        system_prompt: editPrompt,
        category: editCategory || null,
      };

      const res = await fetch("/api/agents", {
        method: isCreating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isCreating ? payload : { id: editing!.id, ...payload }
        ),
      });
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setSaveError(errorBody?.error || "Failed to save agent");
        return;
      }
      await mutate();
      closeEditor();
    } catch {
      setSaveError("Network error while saving agent");
    } finally {
      setSaving(false);
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
  ]);

  const deleteAgent = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/agents?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) await mutate();
    },
    [mutate]
  );

  const createBlank = useCallback(() => {
    setEditing(null);
    setIsCreating(true);
    setEditName("");
    setEditModel(getDefaultNewAgentModel(enabledModels, defaultModelId));
    setEditDescription("");
    setEditPrompt("");
    setEditCategory("");
    setSaveError(null);
  }, [defaultModelId, enabledModels]);

  return {
    isCreating,
    editing,
    editName,
    setEditName,
    editModel,
    editDescription,
    setEditDescription,
    editPrompt,
    setEditPrompt,
    editCategory,
    setEditCategory,
    saving,
    saveError,
    setSaveError,
    isDialogOpen,
    closeEditor,
    openEdit,
    forkAndEdit,
    saveEdit,
    deleteAgent,
    createBlank,
  };
}
