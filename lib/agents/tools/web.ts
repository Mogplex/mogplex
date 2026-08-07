import { z } from "zod";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";
import { defineTool, resolveAppBaseUrl } from "./shared";

const webFetchParams = z
  .object({
    url: z.string().url().describe("The URL to fetch"),
  })
  .strict();

export const webFetch = defineTool({
  description: "Fetch content from a URL and return text",
  inputSchema: webFetchParams,
  execute: async ({ url }: z.infer<typeof webFetchParams>) => {
    const safeUrl = await assertSafeOutboundHttpUrlWithDns(url, "url");
    const res = await fetch(safeUrl, {
      headers: { "User-Agent": "MOGPLEX-Agent/1.0" },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    return { content: text.slice(0, 8000), url: safeUrl, length: text.length };
  },
});

const webSearchParams = z.object({
  query: z.string().describe("Search query"),
  limit: z.number().default(5).describe("Max results"),
});

export const webSearch = defineTool({
  description: "Search the web using DuckDuckGo",
  inputSchema: webSearchParams,
  execute: async ({ query, limit }: z.infer<typeof webSearchParams>) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "MOGPLEX-Agent/1.0" },
    });
    const html = await res.text();
    const results: { title: string; url: string; snippet: string }[] = [];
    const regex =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\S\s]*?<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) && results.length < limit) {
      results.push({ url: match[1], title: match[2], snippet: match[3] });
    }
    return { results, query };
  },
});

const browseSkillsParams = z.object({
  query: z.string().optional().describe("Search query, omit for popular"),
});

export const browseSkills = defineTool({
  description: "Search skills.sh registry for agent skills",
  inputSchema: browseSkillsParams,
  execute: async ({ query }: z.infer<typeof browseSkillsParams>) => {
    const url = query
      ? `https://skills.sh/api/search?q=${encodeURIComponent(query)}`
      : `https://skills.sh/api/search?q=vercel`;
    const res = await fetch(url);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    return { skills: data.skills || data || [] };
  },
});

const browseVercelDocsParams = z.object({
  query: z.string().describe("Search query for Vercel documentation"),
});

export const browseVercelDocs = defineTool({
  description:
    "Search Vercel documentation for guides, best practices, and API references",
  inputSchema: browseVercelDocsParams,
  execute: async ({ query }: z.infer<typeof browseVercelDocsParams>) => {
    const baseUrl = resolveAppBaseUrl();
    const res = await fetch(
      `${baseUrl}/api/skills/vercel-docs?q=${encodeURIComponent(query)}`
    );
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const { docs } = await res.json();
    return {
      docs: (
        docs as {
          title: string;
          path: string;
          url: string;
          description: string;
        }[]
      ).slice(0, 10),
    };
  },
});
