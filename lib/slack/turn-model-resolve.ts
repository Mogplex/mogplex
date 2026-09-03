import { supabaseAdmin } from "@/lib/supabase/admin";
import { listUsableModelIdsForScope } from "@/lib/models/default-model";
import { getSlackModelPreference } from "@/lib/slack/model-preferences";
import {
  pickSlackTurnModel,
  type SlackTurnModelCandidate,
} from "@/lib/slack/turn-model";

async function loadStoredDefaultModel(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("default_model")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return (
    (data as { default_model?: string | null } | null)?.default_model ?? null
  );
}

/** Usable models with their capabilities, recommended models first. */
async function loadUsableModelCandidates(
  usableModelIds: string[]
): Promise<SlackTurnModelCandidate[]> {
  if (usableModelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("ai_models")
    .select("id, capabilities, is_recommended, recommendation_rank")
    .in("id", usableModelIds)
    .order("is_recommended", { ascending: false })
    .order("recommendation_rank", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`Failed to load model catalog: ${error.message}`);
  return ((data ?? []) as SlackTurnModelCandidate[]).map((row) => ({
    id: row.id,
    capabilities: row.capabilities ?? null,
  }));
}

/**
 * Resolves the model for a conversational Slack turn: the explicit Slack
 * preference when usable, otherwise the user's default, otherwise the
 * conversation's stamped model, constrained to models the scope can invoke
 * and biased toward image-capable models when the turn carries screenshots.
 * Returns null when nothing usable was found so the caller keeps its own
 * fallback.
 */
export async function resolveSlackTurnModel(input: {
  installationId: string;
  channelId: string;
  slackUserId: string;
  mogplexUserId: string;
  teamId: string | null;
  conversationModel: string | null;
  needsVision: boolean;
}): Promise<string | null> {
  const [preference, usableModelIds, storedDefaultModel] = await Promise.all([
    getSlackModelPreference({
      installationId: input.installationId,
      channelId: input.channelId,
      slackUserId: input.slackUserId,
    }),
    listUsableModelIdsForScope(input.mogplexUserId, { teamId: input.teamId }),
    loadStoredDefaultModel(input.mogplexUserId),
  ]);
  const usableModels = await loadUsableModelCandidates(usableModelIds);
  return pickSlackTurnModel({
    preferredModel: preference?.model_id ?? null,
    storedDefaultModel,
    conversationModel: input.conversationModel,
    usableModels,
    needsVision: input.needsVision,
  });
}
