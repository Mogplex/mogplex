import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";

/** Display only requests signed and validated by our authorization server. */
export async function readOAuthConsent(query: string, secret: string) {
  if (!(await verifyOAuthQueryParams(query, secret))) return null;
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  if (!clientId || !redirectUri) return null;
  try {
    return {
      clientId,
      destination: new URL(redirectUri).host || new URL(redirectUri).protocol,
      scopes: [
        ...new Set((params.get("scope") ?? "").split(/\s+/).filter(Boolean)),
      ],
    };
  } catch {
    return null;
  }
}
