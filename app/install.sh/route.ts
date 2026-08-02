// 302 to the canonical installer on R2 so www.mogplex.com/install.sh always
// tracks the latest release. The R2 script reads install.mogplex.com/latest.json
// at runtime — no redeploy of the mogplex app is needed when the CLI ships.
// no-store so emergency target changes don't get pinned in CDN caches.
const CANONICAL_INSTALL_URL = "https://install.mogplex.com/install.sh";

export function GET() {
  return new Response(null, {
    status: 302,
    headers: {
      location: CANONICAL_INSTALL_URL,
      "cache-control": "no-store",
    },
  });
}
