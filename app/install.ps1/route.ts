const CANONICAL_INSTALL_URL = "https://install.mogplex.com/install.ps1";

export function GET() {
  return new Response(null, {
    status: 302,
    headers: {
      location: CANONICAL_INSTALL_URL,
      "cache-control": "no-store",
    },
  });
}
