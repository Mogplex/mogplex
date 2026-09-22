export type ConnectionForm = {
  type: "rest_api" | "mcp_server";
  name: string;
  base_url: string;
  auth_type: string;
  auth_header: string;
  mcp_transport: "sse" | "http";
  mcp_url: string;
  credentials: string;
  description: string;
};

export const CONNECTION_AUTH_OPTIONS = [
  { value: "none", label: "No Auth" },
  { value: "bearer", label: "Bearer Token" },
  { value: "api_key", label: "API Key" },
  { value: "basic", label: "Basic Auth" },
] as const;

export const INITIAL_CONNECTION_FORM: ConnectionForm = {
  type: "rest_api",
  name: "",
  base_url: "",
  auth_type: "none",
  auth_header: "Authorization",
  mcp_transport: "http",
  mcp_url: "",
  credentials: "",
  description: "",
};

export function getDefaultAuthHeader(authType: string): string {
  return authType === "api_key" ? "X-API-Key" : "Authorization";
}

export function scrollToConnectionRow(
  connectionId: string | null | undefined
): void {
  if (!connectionId) return;
  document
    .querySelector<HTMLElement>(`[data-connection-id="${connectionId}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
