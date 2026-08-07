"use client";

import { useState, useCallback } from "react";
import type { AgentCategoryRow } from "@/lib/types";

export function useCategoryEditor({
  mutate,
  mutateCategories,
  setEditCategory,
}: {
  mutate: () => Promise<unknown>;
  mutateCategories: () => Promise<unknown>;
  setEditCategory: (v: string) => void;
}) {
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategorySaving, setNewCategorySaving] = useState(false);
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] =
    useState<AgentCategoryRow | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(
    null
  );

  const openNewCategoryDialog = useCallback(() => {
    setNewCategoryLabel("");
    setNewCategoryError(null);
    setNewCategoryOpen(true);
  }, []);

  const closeNewCategoryDialog = useCallback(() => {
    if (newCategorySaving) return;
    setNewCategoryOpen(false);
  }, [newCategorySaving]);

  const createCategory = useCallback(async () => {
    const label = newCategoryLabel.trim().replace(/\s+/g, " ");
    if (!label) {
      setNewCategoryError("Category name is required");
      return;
    }
    setNewCategorySaving(true);
    setNewCategoryError(null);
    try {
      const res = await fetch("/api/agent-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const body = (await res.json().catch(() => null)) as
        | AgentCategoryRow
        | { error?: string }
        | null;
      if (!res.ok || !body || !("slug" in body)) {
        const message =
          body && "error" in body && typeof body.error === "string"
            ? body.error
            : "Failed to create category";
        setNewCategoryError(message);
        return;
      }
      await mutateCategories();
      setEditCategory(body.slug);
      setNewCategoryOpen(false);
    } catch {
      setNewCategoryError("Network error while creating category");
    } finally {
      setNewCategorySaving(false);
    }
  }, [newCategoryLabel, mutateCategories, setEditCategory]);

  const confirmDeleteCategory = useCallback(async () => {
    if (!categoryToDelete) return;
    setDeletingCategoryId(categoryToDelete.id);
    try {
      const res = await fetch(
        `/api/agent-categories?id=${encodeURIComponent(categoryToDelete.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) return;
      await Promise.all([mutateCategories(), mutate()]);
      setCategoryToDelete(null);
    } finally {
      setDeletingCategoryId(null);
    }
  }, [categoryToDelete, mutate, mutateCategories]);

  return {
    newCategoryOpen,
    newCategoryLabel,
    setNewCategoryLabel,
    newCategorySaving,
    newCategoryError,
    manageCategoriesOpen,
    setManageCategoriesOpen,
    categoryToDelete,
    setCategoryToDelete,
    deletingCategoryId,
    openNewCategoryDialog,
    closeNewCategoryDialog,
    createCategory,
    confirmDeleteCategory,
  };
}
