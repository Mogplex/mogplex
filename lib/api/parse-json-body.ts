/**
 * Parse JSON only; callers keep their existing body validation.
 * The default matches Request.json() for mechanical migrations of existing
 * routes. A type argument describes the expected body, not runtime validation.
 */
export async function parseJsonBody<T = Awaited<ReturnType<Request["json"]>>>(
  request: Request
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: (await request.json()) as T };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body." }, { status: 400 }),
    };
  }
}
