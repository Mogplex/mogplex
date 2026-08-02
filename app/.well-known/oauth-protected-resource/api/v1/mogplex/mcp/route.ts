import { buildMogplexMcpProtectedResourceMetadata } from "@/lib/mogplex-api/oauth-config";

export function GET(request: Request) {
  return Response.json(buildMogplexMcpProtectedResourceMetadata(request), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
