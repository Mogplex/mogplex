import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { auth } from "@/lib/better-auth/server";

const getBetterAuthMetadata = oAuthDiscoveryMetadata(auth);

export async function GET(request: Request) {
  const response = await getBetterAuthMetadata(request);
  const metadata = (await response.json()) as {
    scopes_supported?: string[];
    [key: string]: unknown;
  };

  return Response.json(
    {
      ...metadata,
      scopes_supported: [
        ...new Set([...(metadata.scopes_supported ?? []), "read", "write"]),
      ],
    },
    { headers: response.headers }
  );
}
