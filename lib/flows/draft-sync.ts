export type FlowDraftHydrationInput = {
  currentFlowId: string | null;
  incomingFlowId: string;
  hasDraftHistory: boolean;
  hasBaselineDraft: boolean;
  dirty: boolean;
  currentBaselineSignature: string | null;
  incomingSignature: string;
};

export function shouldHydrateFlowDraftFromServer(
  input: FlowDraftHydrationInput
) {
  if (input.currentFlowId !== input.incomingFlowId) {
    return true;
  }

  if (!input.hasDraftHistory || !input.hasBaselineDraft) {
    return true;
  }

  if (input.dirty) {
    return false;
  }

  return input.currentBaselineSignature !== input.incomingSignature;
}
