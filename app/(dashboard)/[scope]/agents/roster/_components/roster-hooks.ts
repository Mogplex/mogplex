import { useEffect, useMemo, useRef } from "react";
import type { Agent, AgentCategoryRow } from "@/lib/types";
import { AGENT_CATEGORIES } from "@/lib/agents/templates";

export type CategoryEntry = [
  string,
  { label: string; slug: string; isCustom: boolean },
];

export const builtInCategoryEntries: CategoryEntry[] = (
  Object.entries(AGENT_CATEGORIES) as [
    string,
    { label: string; slug: string },
  ][]
).map(([slug, { label }]) => [slug, { label, slug, isCustom: false }]);

export const BUILT_IN_CATEGORY_SLUGS = new Set(
  builtInCategoryEntries.map(([slug]) => slug)
);

export function useCategoryData(categories: AgentCategoryRow[]) {
  const allCategoryEntries = useMemo<CategoryEntry[]>(() => {
    const custom: CategoryEntry[] = categories
      .filter((c) => !BUILT_IN_CATEGORY_SLUGS.has(c.slug))
      .map((c) => [c.slug, { label: c.label, slug: c.slug, isCustom: true }]);
    custom.sort((a, b) => a[1].label.localeCompare(b[1].label));
    return [...builtInCategoryEntries, ...custom];
  }, [categories]);

  const renderedCategorySlugs = useMemo(
    () => new Set(allCategoryEntries.map(([slug]) => slug)),
    [allCategoryEntries]
  );

  // Mirror the latest Set into a ref so imperative callbacks (e.g. openEdit
  // invoked right after an SWR mutate) cannot close over a stale snapshot.
  const renderedCategorySlugsRef = useRef(renderedCategorySlugs);
  useEffect(() => {
    renderedCategorySlugsRef.current = renderedCategorySlugs;
  }, [renderedCategorySlugs]);

  const categoryLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [slug, { label }] of allCategoryEntries) map.set(slug, label);
    return map;
  }, [allCategoryEntries]);

  const customCategories = useMemo(
    () => categories.filter((c) => !BUILT_IN_CATEGORY_SLUGS.has(c.slug)),
    [categories]
  );

  return {
    allCategoryEntries,
    renderedCategorySlugs,
    renderedCategorySlugsRef,
    categoryLabelMap,
    customCategories,
  };
}

export function useAgentsByCategory(
  agents: Agent[],
  allCategoryEntries: CategoryEntry[],
  renderedCategorySlugs: Set<string>,
  searchQuery: string
) {
  return useMemo(() => {
    const uncategorized: Agent[] = [];
    const byCategory = new Map<string, Agent[]>();
    for (const [slug] of allCategoryEntries) {
      byCategory.set(slug, []);
    }
    const q = searchQuery.trim().toLowerCase();
    const matches = (a: Agent) => {
      if (!q) return true;
      if (a.name.toLowerCase().includes(q)) return true;
      if (a.description?.toLowerCase().includes(q)) return true;
      return false;
    };
    for (const a of agents) {
      if (!matches(a)) continue;
      if (
        typeof a.category === "string" &&
        renderedCategorySlugs.has(a.category)
      ) {
        byCategory.get(a.category)!.push(a);
      } else if (!a.is_preset) {
        uncategorized.push(a);
      }
    }
    return {
      agentsByCategory: byCategory,
      uncategorizedCustomAgents: uncategorized,
    };
  }, [agents, allCategoryEntries, renderedCategorySlugs, searchQuery]);
}
