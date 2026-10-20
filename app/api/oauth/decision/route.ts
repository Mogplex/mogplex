import { NextResponse } from "next/server";
import { getCanonicalAppUrl } from "@/lib/app-url";

function hasSameOrigin(request: Request) {
  const expectedOrigin = getCanonicalAppUrl(request).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

// Decisions for the retired Supabase OAuth authorization server. MCP clients
// start a new connection instead.
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(
    {
      error: "authorization_flow_retired",
      message: "Start a new connection from your MCP client.",
    },
    { status: 410 }
  );
}
