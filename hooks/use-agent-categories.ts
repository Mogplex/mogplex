"use client";
import useSWR from "swr";
import { fetchJsonArray } from "@/lib/client-fetch";
import type { AgentCategoryRow } from "@/lib/types";

const fetcher = (url: string) =>
  fetchJsonArray<AgentCategoryRow>(url, "Failed to load categories");

export function useAgentCategories() {
  const { data, error, isLoading, mutate } = useSWR<AgentCategoryRow[]>(
    "/api/agent-categories",
    fetcher
  );
  return { categories: data ?? [], isLoading, error, mutate };
}
