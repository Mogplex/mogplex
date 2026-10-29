import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/better-auth/server";
import { legacyMcpMetadata } from "@/lib/better-auth/mcp-request-compatibility";

const getBetterAuthMetadata = oauthProviderAuthServerMetadata(auth);

export async function GET(request: Request) {
  const response = await getBetterAuthMetadata(request);
  const metadata = (await response.json()) as {
    scopes_supported?: string[];
    [key: string]: unknown;
  };

  return Response.json(
    {
      ...legacyMcpMetadata(metadata),
      scopes_supported: [
        ...new Set([...(metadata.scopes_supported ?? []), "read", "write"]),
      ],
    },
    { headers: response.headers }
  );
}
