/**
 * Pull useful context out of @vercel/sandbox APIErrors so our logs aren't
 * just "Status code 400 is not ok". Vercel returns an error envelope that
 * names the actual rejected field (e.g. invalid env var key, bad port).
 */
function extractVercelApiErrorEnvelope(
  err: unknown
): { code: string | null; message: string | null; text: string | null } | null {
  if (!err || typeof err !== "object") return null;
  const maybe = err as {
    json?: unknown;
    text?: unknown;
    response?: { status?: number };
  };

  if (maybe.json && typeof maybe.json === "object") {
    const envelope = maybe.json as {
      error?: { code?: string; message?: string };
      message?: string;
      code?: string;
    };
    if (envelope.error?.message) {
      return {
        code: envelope.error.code ?? null,
        message: envelope.error.message,
        text: null,
      };
    }
    if (envelope.message) {
      return {
        code: envelope.code ?? null,
        message: envelope.message,
        text: null,
      };
    }
  }

  if (typeof maybe.text === "string" && maybe.text.length > 0) {
    return {
      code: null,
      message: null,
      text: maybe.text.slice(0, 500),
    };
  }

  return { code: null, message: null, text: null };
}

export function extractVercelApiErrorCode(err: unknown): string | null {
  return extractVercelApiErrorEnvelope(err)?.code ?? null;
}

export function extractVercelApiErrorDetail(err: unknown): string | null {
  const envelope = extractVercelApiErrorEnvelope(err);
  if (!envelope) return null;
  if (envelope.message) {
    return envelope.code
      ? `${envelope.code}: ${envelope.message}`
      : envelope.message;
  }
  if (envelope.text) {
    return envelope.text;
  }
  return null;
}
