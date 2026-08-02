const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

export type MogplexOAuthDecision = "approve" | "deny";

export function parseMogplexAuthorizationId(value: unknown) {
  if (typeof value !== "string" || !AUTHORIZATION_ID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

export function parseMogplexOAuthDecision(
  value: unknown
): MogplexOAuthDecision | null {
  return value === "approve" || value === "deny" ? value : null;
}

export function buildMogplexOAuthConsentPath(
  authorizationId: string,
  decisionError?: string | null
) {
  const params = new URLSearchParams({ authorization_id: authorizationId });
  if (decisionError) params.set("decision_error", decisionError);
  return `/oauth/consent?${params.toString()}`;
}

export function buildMogplexOAuthTerminalErrorPath(decisionError: string) {
  return `/oauth/consent?${new URLSearchParams({
    decision_error: decisionError,
  }).toString()}`;
}
