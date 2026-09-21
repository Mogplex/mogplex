import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requestExa } from "@/lib/agents/tools/exa";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";

export const runtime = "nodejs";
export const maxDuration = 60;

const inputSchema = z.discriminatedUnion("endpoint", [
  z
    .object({
      endpoint: z.literal("search"),
      body: z
        .object({
          query: z.string().trim().min(1).max(4000),
          type: z.literal("auto"),
          contents: z.object({ highlights: z.literal(true) }).strict(),
          numResults: z.number().int().min(1).max(25).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      endpoint: z.literal("contents"),
      body: z
        .object({
          urls: z.array(z.string().url()).length(1),
          text: z
            .object({ maxCharacters: z.number().int().min(1000).max(100000) })
            .strict(),
          maxAgeHours: z.number().int().min(-1).optional(),
        })
        .strict(),
    })
    .strict(),
]);

/** Trusted server-to-server relay for workers that cannot export Vercel secrets. */
export async function POST(request: Request) {
  const secret = process.env.EXA_RESEARCH_SECRET?.trim();
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    !secret ||
    secret === "[SENSITIVE]" ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  let input: z.infer<typeof inputSchema>;
  try {
    const text = await request.text();
    if (text.length > 16000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    input = inputSchema.parse(JSON.parse(text));
    if (input.endpoint === "contents")
      await assertSafeOutboundHttpUrlWithDns(input.body.urls[0], "url");
  } catch {
    return Response.json(
      { error: "Invalid research request" },
      { status: 400 }
    );
  }
  // Never relay recursively when this deployment lacks its own Exa credential.
  const result = await requestExa(
    input.endpoint,
    input.body,
    request.signal,
    false
  );
  return Response.json(
    result.data ?? { error: "Web research provider unavailable" },
    {
      status: result.data ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
