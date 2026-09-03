/**
 * Picks the model for one conversational Slack turn.
 *
 * Slack-created conversations never carry a deliberately chosen model: the
 * `conversations.model` column default stamps them with the platform's static
 * default, which may be a model the user has disabled. This picker therefore
 * ranks the explicit Slack preference first, then the user's stored default,
 * and only then the conversation's stamped model, restricted to models the
 * user can actually invoke. When the turn carries images it prefers a model
 * that can see them.
 */

export type SlackTurnModelCandidate = {
  id: string;
  capabilities: string[] | null;
};

const IMAGE_INPUT_CAPABILITIES = new Set(["vision", "image", "image-input"]);

export function canModelSeeImages(
  candidate: SlackTurnModelCandidate | undefined
) {
  return Boolean(
    candidate?.capabilities?.some((capability) =>
      IMAGE_INPUT_CAPABILITIES.has(capability.toLowerCase())
    )
  );
}

export function pickSlackTurnModel(input: {
  preferredModel: string | null;
  storedDefaultModel: string | null;
  conversationModel: string | null;
  /** Models the user can invoke in this scope, best candidates first. */
  usableModels: SlackTurnModelCandidate[];
  needsVision: boolean;
}): string | null {
  const usable = new Map(input.usableModels.map((model) => [model.id, model]));
  if (input.preferredModel && usable.has(input.preferredModel)) {
    return input.preferredModel;
  }

  const ranked: string[] = [];
  for (const id of [input.storedDefaultModel, input.conversationModel]) {
    if (id && usable.has(id) && !ranked.includes(id)) ranked.push(id);
  }

  if (input.needsVision) {
    const seeing =
      ranked.find((id) => canModelSeeImages(usable.get(id))) ??
      input.usableModels.find((model) => canModelSeeImages(model))?.id;
    if (seeing) return seeing;
  }

  return ranked[0] ?? null;
}
