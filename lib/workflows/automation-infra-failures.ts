export type AutomationInfrastructureFailureClass =
  | "supabase_unavailable"
  | "html_error_page";

function normalizeFailureText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.replace(/\s+/g, " ");
}

function looksLikeHtmlErrorPage(value: string) {
  return /<!doctype html|<html|<head|<body|<title>|<\/html>/i.test(value);
}

function looksLikeSupabaseOutage(value: string) {
  return (
    /supabase\.co/i.test(value) &&
    (/cloudflare/i.test(value) ||
      /error code 52\d/i.test(value) ||
      /connection timed out/i.test(value) ||
      looksLikeHtmlErrorPage(value))
  );
}

function classifyNormalizedAutomationInfrastructureFailure(normalized: string) {
  if (looksLikeSupabaseOutage(normalized)) {
    return {
      failureClass: "supabase_unavailable" as const,
      sanitizedText: "Supabase was unavailable while recording workflow state.",
      detail: /error code 522|connection timed out/i.test(normalized)
        ? "Cloudflare 522 while reaching the Supabase origin"
        : "Supabase returned an HTML error page",
    };
  }

  if (looksLikeHtmlErrorPage(normalized)) {
    return {
      failureClass: "html_error_page" as const,
      sanitizedText: "Automation infrastructure returned an HTML error page.",
      detail: null,
    };
  }

  return null;
}

export function classifyAutomationInfrastructureFailure(
  message: string | null | undefined
) {
  const normalized = normalizeFailureText(message);
  if (!normalized) {
    return null;
  }

  return classifyNormalizedAutomationInfrastructureFailure(normalized);
}

export function sanitizeAutomationInfrastructureText(
  message: string | null | undefined
) {
  const normalized = normalizeFailureText(message);
  if (!normalized) {
    return null;
  }

  return (
    classifyNormalizedAutomationInfrastructureFailure(normalized)
      ?.sanitizedText ?? normalized
  );
}

export function formatAutomationInfrastructureFailureLabel(
  value: AutomationInfrastructureFailureClass | string | null | undefined
) {
  switch (value) {
    case "supabase_unavailable":
      return "Supabase unavailable";
    case "html_error_page":
      return "HTML error page";
    default:
      return null;
  }
}
