import { NextResponse } from "next/server";

type SkillDetail = {
  name: string;
  description: string;
  installs: number;
  source: string;
  content: string;
  installCommand: string;
  audited: boolean;
};

const detailCache = new Map<string, { data: SkillDetail; time: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const fullPath = path.join("/");

    // Check cache
    const cached = detailCache.get(fullPath);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return NextResponse.json(cached.data, {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      });
    }

    // Fetch the skill page from skills.sh
    const pageUrl = `https://skills.sh/${fullPath}`;
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": "MOGPLEX/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Skill not found: ${fullPath}` },
        { status: res.status }
      );
    }

    const html = await res.text();

    // Extract skill name — usually in an h1 or title
    const nameMatch =
      /<h1[^>]*>([^<]+)<\/h1>/.exec(html) ||
      /<title>([^<]+)<\/title>/.exec(html);
    const name = nameMatch
      ? nameMatch[1].replace(/ [|–-].*/g, "").trim()
      : (path.at(-1) ?? fullPath);

    // Extract description from meta tag or first paragraph
    const descMatch =
      /<meta[^>]+name="description"[^>]+content="([^"]+)"/.exec(html) ||
      /<p[^>]*class="[^"]*description[^"]*"[^>]*>([^<]+)<\/p>/.exec(html);
    const description = descMatch ? descMatch[1].trim() : "";

    // Extract install count
    const installMatch = /([\d,]+)\s*(?:weekly\s+)?install/i.exec(html);
    const installs = installMatch
      ? Number.parseInt(installMatch[1].replace(/,/g, ""), 10)
      : 0;

    // Extract audit status
    const audited = /audited|verified/i.test(html);

    // Determine source (owner/repo)
    const source = path.length >= 2 ? `${path[0]}/${path[1]}` : fullPath;

    // Extract skill ID
    const skillId =
      path.length >= 3 ? path.slice(2).join("/") : (path.at(-1) ?? fullPath);

    // Try to extract SKILL.md content from code blocks or pre elements
    let content = "";
    const codeBlockMatch =
      /<pre[^>]*><code[^>]*>([\S\s]*?)<\/code><\/pre>/.exec(html) ||
      /<pre[^>]*>([\S\s]*?)<\/pre>/.exec(html);
    if (codeBlockMatch) {
      content = codeBlockMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    }

    // Also try to find content in Next.js page data
    if (!content) {
      const scriptMatch =
        /<script[^>]*id="__NEXT_DATA__"[^>]*>([\S\s]*?)<\/script>/.exec(html);
      if (scriptMatch) {
        try {
          const nextData = JSON.parse(scriptMatch[1]);
          const pageProps = nextData?.props?.pageProps;
          if (pageProps?.content) content = pageProps.content;
          if (pageProps?.skill?.content) content = pageProps.skill.content;
          if (pageProps?.description && !description)
            content = pageProps.description;
        } catch {
          // JSON parse failed
        }
      }
    }

    const installCommand = `npx skills add ${source} --skill ${skillId}`;

    const detail: SkillDetail = {
      name,
      description,
      installs,
      source,
      content,
      installCommand,
      audited,
    };

    detailCache.set(fullPath, { data: detail, time: Date.now() });

    // Evict old cache entries
    if (detailCache.size > 100) {
      const oldest = [...detailCache.entries()].sort(
        (a, b) => a[1].time - b[1].time
      );
      for (let i = 0; i < 20; i++) detailCache.delete(oldest[i][0]);
    }

    return NextResponse.json(detail, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
