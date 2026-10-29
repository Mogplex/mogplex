import type { GenericEndpointContext } from "better-auth";

type SecretMethod = "client_secret_basic" | "client_secret_post";
export type LegacySecretMethod = (
  clientId: string
) => Promise<SecretMethod | null>;

export async function legacyClientSecretMethod(
  adapter: Pick<GenericEndpointContext["context"]["adapter"], "findOne">,
  clientId: string
): Promise<SecretMethod | null> {
  const client = await adapter.findOne<{
    legacySecretMethods?: boolean;
    tokenEndpointAuthMethod?: string;
  }>({ model: "oauthClient", where: [{ field: "clientId", value: clientId }] });
  const method = client?.tokenEndpointAuthMethod;
  return client?.legacySecretMethods &&
    (method === "client_secret_basic" || method === "client_secret_post")
    ? method
    : null;
}

function basicCredentials(value: string | null) {
  const encoded = value?.match(/^Basic ([a-z0-9+/]+={0,2})$/i)?.[1];
  if (!encoded) return null;
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
    )
      return null;
    const decoded = bytes.toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon === -1) return null;
    const clientId = decodeURIComponent(decoded.slice(0, colon));
    const secret = decodeURIComponent(decoded.slice(colon + 1));
    return clientId && secret ? { clientId, secret } : null;
  } catch {
    return null;
  }
}

/** 1.6 accepted both secret transports and did not persist its declared method. */
export async function normalizeLegacyClientSecret(
  form: URLSearchParams,
  headers: Headers,
  loadMethod: LegacySecretMethod
) {
  const ids = form.getAll("client_id").filter(Boolean);
  const secrets = form.getAll("client_secret").filter(Boolean);
  const authorization = headers.get("authorization");
  // Preserve native rejection of ambiguous or mixed authentication methods.
  if (
    ids.length > 1 ||
    secrets.length > 1 ||
    (authorization && secrets.length > 0) ||
    form.get("client_assertion") ||
    form.get("client_assertion_type")
  )
    return;
  const basic = basicCredentials(authorization);
  if (authorization && !basic) return;
  if (basic && ids[0] && ids[0] !== basic.clientId) return;
  const clientId = ids[0] ?? basic?.clientId;
  if (!clientId) return;
  const method = await loadMethod(clientId);
  if (method === "client_secret_basic" && !authorization && secrets[0]) {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secrets[0])}`).toString("base64")}`
    );
    form.delete("client_secret");
  } else if (method === "client_secret_post" && basic) {
    headers.delete("authorization");
    form.set("client_id", basic.clientId);
    form.set("client_secret", basic.secret);
  }
}
