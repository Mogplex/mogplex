import { after } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import { syncProviderIcons } from "@/lib/models/provider-icon-sync";
import type { ModelSupersessionRow } from "@/lib/models/model-supersessions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SyncModelsDeps } from "./types";
import { buildStaleGatewayModelUpdate } from "./pricing";

export const defaultSyncModelsDeps: SyncModelsDeps = {
  requireMachineApiAuth,
  syncProviderIcons,
  scheduleAfterResponse: (work) => {
    after(work);
  },
  async fetchGatewayModels() {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/models");
    if (!res.ok) {
      throw new Error("Failed to fetch AI Gateway models");
    }
    const { data: models } = (await res.json()) as {
      data: Array<{
        id: string;
        name: string;
        owned_by: string;
        type: string;
        context_window?: number;
        max_tokens?: number;
        tags?: string[];
        released?: number;
        pricing?: {
          input?: string;
          output?: string;
          cache_input?: string;
          cache_creation?: string;
          cache_read?: string;
          cache_write?: string;
          input_cache_read?: string;
          input_cache_write?: string;
          input_cache_creation?: string;
        };
      }>;
    };
    return models;
  },
  async listExistingModelIds() {
    const { data, error } = await supabaseAdmin.from("ai_models").select("id");

    return {
      data: data?.map((row) => row.id) ?? null,
      error: error ? { message: error.message } : null,
    };
  },
  async markModelsUnavailable(modelIds) {
    if (modelIds.length === 0) {
      return { error: null };
    }

    const { error } = await supabaseAdmin
      .from("ai_models")
      .update(buildStaleGatewayModelUpdate())
      .in("id", modelIds);

    return {
      error: error ? { message: error.message } : null,
    };
  },
  async listModelSupersessions() {
    const { data, error } = await supabaseAdmin
      .from("model_supersessions")
      .select("deprecated_model_id, successor_model_id");

    return {
      data: (data ?? null) as ModelSupersessionRow[] | null,
      error: error ? { message: error.message } : null,
    };
  },
  async recordModelSupersessions(rows) {
    if (rows.length === 0) {
      return { error: null };
    }

    const { error } = await supabaseAdmin.from("model_supersessions").upsert(
      rows.map((row) => ({ ...row, updated_at: new Date().toISOString() })),
      { onConflict: "deprecated_model_id" }
    );

    return {
      error: error ? { message: error.message } : null,
    };
  },
  async listEffectiveModelSupersessions() {
    const { data, error } = await supabaseAdmin
      .from("model_supersessions_effective")
      .select("deprecated_model_id");

    return {
      data:
        data?.map(
          (row) => (row as { deprecated_model_id: string }).deprecated_model_id
        ) ?? null,
      error: error ? { message: error.message } : null,
    };
  },
  async deleteModelSupersessions(deprecatedModelIds) {
    if (deprecatedModelIds.length === 0) {
      return { error: null };
    }

    const { error } = await supabaseAdmin
      .from("model_supersessions")
      .delete()
      .in("deprecated_model_id", deprecatedModelIds);

    return {
      error: error ? { message: error.message } : null,
    };
  },
  async upgradeDeprecatedModelPins() {
    const { data, error } = await supabaseAdmin.rpc(
      "upgrade_deprecated_model_pins"
    );

    return {
      data: (data ?? null) as Record<string, number> | null,
      error: error ? { message: error.message } : null,
    };
  },
  async upsertModelsBatch(batch) {
    const { error } = await supabaseAdmin
      .from("ai_models")
      .upsert(batch, { onConflict: "id" });

    return {
      error: error ? { message: error.message } : null,
    };
  },
};
