import { NextResponse } from "next/server";

type VercelDoc = {
  title: string;
  path: string;
  url: string;
  description: string;
  depth: number;
};

let cachedDocs: VercelDoc[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getDocsIndex(): Promise<VercelDoc[]> {
  if (cachedDocs && Date.now() - cacheTime < CACHE_TTL) return cachedDocs;

  const res = await fetch("https://vercel.com/docs/llms.txt", {
    headers: { "User-Agent": "MOGPLEX/1.0" },
  });
  if (!res.ok) throw new Error(`Failed to fetch llms.txt: ${res.status}`);
  const text = await res.text();

  const docs: VercelDoc[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // llms.txt format: indented markdown links with optional description
    // e.g. "- [Title](url): Description" or "  - [Title](url)"
    const linkMatch = /^-\s*\[([^\]]+)]\(([^)]+)\)(?::\s*(.*))?$/.exec(trimmed);
    if (!linkMatch) continue;

    const [, title, rawUrl, description] = linkMatch;

    // Extract path from vercel.com/docs/ URLs — skip non-docs URLs (kb, blog, etc.)
    const docsMatch = /vercel\.com\/docs\/(.+?)(?:\.md)?$/.exec(rawUrl);
    if (!docsMatch) continue;

    const path = docsMatch[1];
    const depth = path.split("/").length - 1;

    docs.push({
      title,
      path,
      url: `https://vercel.com/docs/${path}`,
      description: description?.trim() || "",
      depth,
    });
  }

  cachedDocs = docs;
  cacheTime = Date.now();
  return docs;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.toLowerCase();

    const docs = await getDocsIndex();

    let filtered: VercelDoc[];
    if (q) {
      filtered = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.path.toLowerCase().includes(q)
      );
    } else {
      // Return top entries — prioritize key topics
      const priority = [
        "ai-gateway",
        "ai-sdk",
        "frameworks",
        "functions",
        "storage",
        "security",
        "cli",
        "rest-api",
      ];
      filtered = docs
        .sort((a, b) => {
          const aIdx = priority.findIndex((p) => a.path.startsWith(p));
          const bIdx = priority.findIndex((p) => b.path.startsWith(p));
          const aScore = aIdx === -1 ? 100 : aIdx;
          const bScore = bIdx === -1 ? 100 : bIdx;
          return aScore - bScore || a.depth - b.depth;
        })
        .slice(0, 50);
    }

    return NextResponse.json(
      { docs: filtered.slice(0, 100) },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
