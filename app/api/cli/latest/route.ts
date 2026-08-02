import { NextResponse } from "next/server";
import {
  CANONICAL_CLI_INSTALL_SCRIPT_URL,
  fetchCliReleaseManifest,
} from "@/lib/cli-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const manifest = await fetchCliReleaseManifest();

  if (!manifest) {
    return NextResponse.json(
      {
        error: "CLI release manifest is unavailable",
        installScriptUrl: CANONICAL_CLI_INSTALL_SCRIPT_URL,
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      }
    );
  }

  return NextResponse.json(manifest, {
    headers: { "cache-control": "no-store" },
  });
}
