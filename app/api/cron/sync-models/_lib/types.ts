import type { ProviderIconSyncResult } from "@/lib/models/provider-icon-sync";
import type { ModelSupersessionRow } from "@/lib/models/model-supersessions";

export type GatewayModel = {
  id: string;
  name: string;
  owned_by: string;
  type: string;
  context_window?: number;
  max_tokens?: number;
  tags?: string[];
  released?: number;
  // Vercel's catalog exposes cache pricing under different keys depending on
  // provider. Anthropic models commonly use cache_input / cache_creation; some
  // entries use the cache_read / cache_write shorthand instead. Newer rows can
  // expose input_cache_read / input_cache_write. Accept all known variants.
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
};

export type SyncModelsDeps = {
  requireMachineApiAuth: (
    request: Request,
    pathname: string
  ) => Response | null | undefined;
  fetchGatewayModels: () => Promise<GatewayModel[]>;
  syncProviderIcons: (providers: string[]) => Promise<ProviderIconSyncResult>;
  scheduleAfterResponse: (work: () => void | Promise<void>) => void;
  listExistingModelIds: () => Promise<{
    data: string[] | null;
    error: { message: string } | null;
  }>;
  markModelsUnavailable: (
    modelIds: string[]
  ) => Promise<{ error: { message: string } | null }>;
  listModelSupersessions: () => Promise<{
    data: ModelSupersessionRow[] | null;
    error: { message: string } | null;
  }>;
  recordModelSupersessions: (
    rows: ModelSupersessionRow[]
  ) => Promise<{ error: { message: string } | null }>;
  // Removes mappings for models the policy no longer considers superseded.
  deleteModelSupersessions: (
    deprecatedModelIds: string[]
  ) => Promise<{ error: { message: string } | null }>;
  // The subset of mappings currently in effect, i.e. what both consumers see.
  listEffectiveModelSupersessions: () => Promise<{
    data: string[] | null;
    error: { message: string } | null;
  }>;
  // Repoints saved references (draft graphs, agent base models, default
  // models) at the recorded successors. Returns per-table counts for logging.
  upgradeDeprecatedModelPins: () => Promise<{
    data: Record<string, number> | null;
    error: { message: string } | null;
  }>;
  upsertModelsBatch: (
    batch: Array<{
      id: string;
      provider: string;
      name: string;
      context_length: number | null;
      capabilities: string[];
      pricing_input: number | null;
      pricing_output: number | null;
      pricing_cache_read: number | null;
      pricing_cache_write: number | null;
      is_available: boolean;
      is_recommended: boolean;
      recommendation_bucket: "open" | "frontier" | null;
      recommendation_rank: number | null;
      recommendation_reason: string | null;
      recommended_at: string | null;
      updated_at: string;
    }>
  ) => Promise<{ error: { message: string } | null }>;
};

export type SupersessionReconcileResult = {
  // "aborted" means the reconcile bailed early on a database error; the counts
  // below describe what it managed before that, not what was needed.
  reconcile_status: "ok" | "aborted";
  supersessions_recorded: number;
  supersessions_purged: number;
  pins_upgraded: Record<string, number> | null;
};
