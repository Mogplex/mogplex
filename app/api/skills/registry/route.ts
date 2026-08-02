import { NextResponse } from "next/server";

type RegistrySkill = {
  id: string;
  skillId: string;
  name: string;
  source: string;
  installs: number;
  description?: string;
};

let cachedLeaderboard: RegistrySkill[] | null = null;
let leaderboardCacheTime = 0;

const cachedSearches = new Map<
  string,
  { skills: RegistrySkill[]; time: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function scrapeLeaderboard(): Promise<RegistrySkill[]> {
  if (cachedLeaderboard && Date.now() - leaderboardCacheTime < CACHE_TTL) {
    return cachedLeaderboard;
  }

  const res = await fetch("https://skills.sh/", {
    headers: { "User-Agent": "MOGPLEX/1.0" },
  });
  if (!res.ok) throw new Error(`Failed to fetch skills.sh: ${res.status}`);
  const html = await res.text();

  const skills: RegistrySkill[] = [];

  // skills.sh leaderboard renders cards as anchor tags with grid layout:
  //   <a href="/owner/repo/skill-id">
  //     <span>1</span>              ← rank number
  //     <h3>skill-name</h3>         ← skill name
  //     <p>owner/repo</p>           ← source
  //     <span>593.0K</span>         ← install count
  //   </a>
  const cardRegex = /<a[^>]+href="\/([^"]+)"[^>]*>[\S\s]*?<\/a>/g;
  let match;

  while ((match = cardRegex.exec(html))) {
    const fullPath = match[1];
    const parts = fullPath.split("/");
    if (parts.length < 3) continue;

    const [owner, repo, ...rest] = parts;
    const skillId = rest.join("/");
    const source = `${owner}/${repo}`;
    const id = `${source}/${skillId}`;

    const cardHtml = match[0];

    // Extract name from <h3> tag (the actual skill name)
    const nameMatch = /<h3[^>]*>([^<]+)<\/h3>/.exec(cardHtml);
    const name = nameMatch ? nameMatch[1].trim() : skillId;

    // Extract install count — format like "593.0K" or "1,234"
    const installMatch =
      /([\d,.]+K?)\s*<\/span>\s*<\/div>\s*<\/a>/.exec(cardHtml) ||
      /<span[^>]*font-mono[^>]*>([\d,.]+K?)<\/span>/.exec(cardHtml);
    let installs = 0;
    if (installMatch) {
      const raw = installMatch[1];
      installs = raw.endsWith("K")
        ? Math.round(Number.parseFloat(raw.replace(/,/g, "")) * 1000)
        : Number.parseInt(raw.replace(/,/g, ""), 10);
    }

    if (skillId && !skills.some((s) => s.id === id)) {
      skills.push({ id, skillId, name: name || skillId, source, installs });
    }
  }

  // Fallback: try extracting from JSON-LD or script data if card parsing yields nothing
  if (skills.length === 0) {
    const jsonMatch =
      /<script[^>]*type="application\/json"[^>]*>([\S\s]*?)<\/script>/.exec(
        html
      );
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const items = Array.isArray(data)
          ? data
          : data?.skills || data?.props?.pageProps?.skills || [];
        for (const item of items) {
          if (item.skillId || item.id) {
            skills.push({
              id: item.id || `${item.source || "unknown"}/${item.skillId}`,
              skillId: item.skillId || item.id,
              name: item.name || item.skillId || item.id,
              source: item.source || "unknown",
              installs: item.installs || 0,
            });
          }
        }
      } catch {
        // JSON parse failed, continue
      }
    }
  }

  cachedLeaderboard = skills;
  leaderboardCacheTime = Date.now();
  return skills;
}

async function searchSkills(query: string): Promise<RegistrySkill[]> {
  const cached = cachedSearches.get(query);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.skills;
  }

  const res = await fetch(
    `https://skills.sh/api/search?q=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": "MOGPLEX/1.0" } }
  );
  if (!res.ok) throw new Error(`skills.sh search failed: ${res.status}`);

  const data = await res.json();
  const skills: RegistrySkill[] = (data.skills || []).map(
    (s: {
      id?: string;
      skillId?: string;
      name?: string;
      source?: string;
      installs?: number;
    }) => ({
      id: s.id || `${s.source || "unknown"}/${s.skillId || s.name}`,
      skillId: s.skillId || s.name || "",
      name: s.name || s.skillId || "",
      source: s.source || "",
      installs: s.installs || 0,
    })
  );

  cachedSearches.set(query, { skills, time: Date.now() });

  // Evict old cache entries
  if (cachedSearches.size > 50) {
    const oldest = [...cachedSearches.entries()].sort(
      (a, b) => a[1].time - b[1].time
    );
    for (let i = 0; i < 10; i++) cachedSearches.delete(oldest[i][0]);
  }

  return skills;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();

    let skills: RegistrySkill[];

    if (q) {
      skills = await searchSkills(q);
    } else {
      // No query — try scraping leaderboard, fall back to a default search
      try {
        skills = await scrapeLeaderboard();
      } catch {
        skills = [];
      }

      if (skills.length === 0) {
        // Fallback: search for popular terms
        skills = await searchSkills("vercel");
      }
    }

    return NextResponse.json(
      { skills },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, skills: [] }, { status: 500 });
  }
}
