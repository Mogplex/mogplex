import { z } from "zod";
import { resolveAppBaseUrl } from "./shared";

const resultSchema = z.object({
  url: z.string().url(),
  title: z.string().nullish(),
  publishedDate: z.string().nullish(),
  author: z.string().nullish(),
  highlights: z.array(z.string()).optional(),
  text: z.string().optional(),
});

const responseSchema = z.object({
  results: z.array(resultSchema),
  statuses: z
    .array(z.object({ id: z.string(), status: z.string() }))
    .optional(),
  requestId: z.string().optional(),
});

/** Keep the Vercel-provisioned platform key on the server, never in tool output. */
export async function requestExa(
  endpoint: "search" | "contents",
  body: Record<string, unknown>,
  abortSignal?: AbortSignal,
  allowRelay = true
) {
  const configuredKey = process.env.EXA_API_KEY?.trim();
  const apiKey = configuredKey === "[SENSITIVE]" ? undefined : configuredKey;
  const researchSecret = process.env.EXA_RESEARCH_SECRET?.trim();
  const relay =
    !apiKey && allowRelay && researchSecret && researchSecret !== "[SENSITIVE]";
  if (!apiKey && !relay) {
    return {
      error: "Web research is unavailable: EXA_API_KEY is not configured.",
    };
  }
  try {
    const timeout = AbortSignal.timeout(30_000);
    const target = relay
      ? new URL("/api/internal/exa", resolveAppBaseUrl())
      : new URL(`https://api.exa.ai/${endpoint}`);
    if (relay && target.protocol !== "https:")
      return { error: "Web research relay requires an HTTPS application URL." };
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(relay
          ? { Authorization: `Bearer ${researchSecret}` }
          : { "x-api-key": apiKey! }),
      },
      body: JSON.stringify(relay ? { endpoint, body } : body),
      signal: abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout,
      redirect: "error",
    });
    if (!response.ok) {
      // Provider error bodies may contain request data. Return only the status.
      return { error: `Exa ${endpoint} failed (HTTP ${response.status}).` };
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return { error: "Exa returned an invalid response." };
    return { data: parsed.data };
  } catch {
    return {
      error: "Exa request failed or was cancelled. No results were retrieved.",
    };
  }
}
