"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetchJsonObject } from "@/lib/client-fetch";
import { chainsEqual, type ModelChain } from "./model-chain";

const url = "/api/settings/model-chain";
const emptyChain: ModelChain = { primary: "", fallbacks: [] };

export function useModelChain() {
  const { mutate: refresh } = useSWRConfig();
  const { data, error, isLoading, mutate } = useSWR<ModelChain>(
    url,
    (key) => fetchJsonObject<ModelChain>(key, "Unable to load model chain"),
    { refreshInterval: 0, shouldRetryOnError: false }
  );
  const [draft, setDraft] = useState<ModelChain | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const value = draft ?? data ?? emptyChain;
  const dirty = data !== undefined && !chainsEqual(value, data);

  function change(next: ModelChain) {
    setDraft(next);
    setStatus("");
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setStatus("");
    try {
      const result = await fetchJsonObject<ModelChain>(
        url,
        "Unable to save model chain",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }
      );
      await mutate(result, false);
      setDraft(null);
      setStatus("Chain saved.");
      // Notify model consumers after the transaction succeeds. A refresh failure
      // must not misreport a committed save as a failed write.
      void refresh(
        (key) =>
          key === "/api/settings" ||
          key === "/api/settings/model-fallbacks" ||
          key === "/api/settings/model-targets" ||
          (Array.isArray(key) && key[0] === "/api/models")
      ).catch(() => setStatus("Chain saved. Reload to refresh model lists."));
    } catch (cause) {
      setStatus(
        cause instanceof Error ? cause.message : "Unable to save model chain"
      );
    } finally {
      setSaving(false);
    }
  }

  return {
    value,
    dirty,
    saving,
    status,
    loading: isLoading,
    loadError: Boolean(error),
    disabled: !data || Boolean(error) || saving,
    onChange: change,
    onSave: () => void save(),
    onDiscard: () => {
      setDraft(null);
      setStatus("");
    },
    onRetry: () => {
      void mutate().catch(() => {});
    },
  };
}
