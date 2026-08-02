"use client";
import useSWR from "swr";
import { useCallback } from "react";
import { fetchJsonObject } from "@/lib/client-fetch";
import { toast } from "@/hooks/use-toast";

export type NewModel = {
  id: string;
  name: string;
  provider: string;
};

type NewModelsResponse = {
  models: NewModel[];
  autoEnable: boolean;
};

const fetcher = (url: string) =>
  fetchJsonObject<NewModelsResponse>(url, "Failed to load new models");

async function acknowledge(action: "dismiss" | "disable") {
  const response = await fetch("/api/models/new-arrivals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update new models (${response.status})`);
  }
}

async function patchAutoEnable(value: boolean) {
  const response = await fetch("/api/models/new-arrivals", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoEnable: value }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update setting (${response.status})`);
  }
}

export function useNewModels() {
  const { data, mutate } = useSWR<NewModelsResponse>(
    "/api/models/new-arrivals",
    fetcher,
    { revalidateOnFocus: false }
  );

  const newModels = data?.models ?? [];
  const autoEnable = data?.autoEnable ?? true;

  const resolve = useCallback(
    async (action: "dismiss" | "disable") => {
      // Optimistically clear the popup so it does not flash back on revalidate.
      await mutate(
        (previous) =>
          previous
            ? {
                models: [],
                autoEnable: action === "disable" ? false : previous.autoEnable,
              }
            : previous,
        false
      );
      try {
        await acknowledge(action);
      } catch (error) {
        toast({
          title: "Could not save your choice",
          description:
            error instanceof Error
              ? error.message
              : "Please try again in a moment.",
          variant: "destructive",
        });
        await mutate();
      }
    },
    [mutate]
  );

  const dismiss = useCallback(() => resolve("dismiss"), [resolve]);
  const disable = useCallback(() => resolve("disable"), [resolve]);

  const setAutoEnable = useCallback(
    async (value: boolean) => {
      await mutate(
        (previous) =>
          previous ? { ...previous, autoEnable: value } : previous,
        false
      );
      try {
        await patchAutoEnable(value);
      } catch (error) {
        toast({
          title: "Could not save your choice",
          description:
            error instanceof Error
              ? error.message
              : "Please try again in a moment.",
          variant: "destructive",
        });
        await mutate();
      }
    },
    [mutate]
  );

  return { newModels, autoEnable, dismiss, disable, setAutoEnable };
}
