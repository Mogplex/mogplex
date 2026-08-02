export type SandboxErrorCode =
  | "GITHUB_NOT_CONNECTED"
  | "SANDBOX_SERVICE_UNAVAILABLE"
  | "VERCEL_CONNECTION_REQUIRED"
  | "VERCEL_RECONNECT_REQUIRED"
  | "VERCEL_PROJECT_REQUIRED"
  | "UNKNOWN";

export type SandboxError = {
  message: string;
  code: SandboxErrorCode;
  launchAttemptId?: string;
};

let sandboxLaunchAttemptFallbackSequence = 0;

export function createSandboxLaunchAttemptId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `launch-${globalThis.crypto.randomUUID()}`;
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const values = new Uint32Array(2);
    globalThis.crypto.getRandomValues(values);
    return `launch-${values[0].toString(36)}-${values[1].toString(36)}`;
  }

  const now = Date.now().toString(36);
  const time =
    typeof globalThis.performance?.now === "function"
      ? Math.floor(globalThis.performance.now() * 1000).toString(36)
      : "0";
  const sequence = (sandboxLaunchAttemptFallbackSequence++).toString(36);
  return `launch-${now}-${time}-${sequence}`;
}

export const SANDBOX_ERROR_CTA: Record<
  SandboxErrorCode,
  { label: string; href: string } | null
> = {
  GITHUB_NOT_CONNECTED: { label: "Connect GitHub", href: "/settings" },
  SANDBOX_SERVICE_UNAVAILABLE: null,
  VERCEL_CONNECTION_REQUIRED: {
    label: "Connect Vercel",
    href: "/api/auth/vercel",
  },
  VERCEL_RECONNECT_REQUIRED: {
    label: "Reconnect Vercel",
    href: "/api/auth/vercel",
  },
  VERCEL_PROJECT_REQUIRED: {
    label: "Open project settings",
    href: "/projects/repositories",
  },
  UNKNOWN: null,
};

export function parseSandboxErrorCode(message: string): SandboxErrorCode {
  // Order matters: platform-billing blockers include the phrase "link
  // personal vercel", which would otherwise be caught by later generic
  // Vercel matches. Keep the most-specific messages first.
  const lower = message.toLowerCase();
  if (lower.includes("github account")) return "GITHUB_NOT_CONNECTED";
  if (
    lower.includes("platform sandbox billing is not enabled") ||
    lower.includes("platform sandbox access is not enabled") ||
    lower.includes("link personal vercel")
  ) {
    return "VERCEL_CONNECTION_REQUIRED";
  }
  if (lower.includes("reconnect vercel")) return "VERCEL_RECONNECT_REQUIRED";
  if (
    lower.includes("select or create a vercel project") ||
    lower.includes("missing its stored vercel project")
  ) {
    return "VERCEL_PROJECT_REQUIRED";
  }
  if (
    lower.includes("sandbox service not configured") ||
    lower.includes("preview service is unavailable") ||
    lower.includes("status code 401") ||
    lower.includes("status code 403")
  ) {
    return "SANDBOX_SERVICE_UNAVAILABLE";
  }
  return "UNKNOWN";
}

export function presentSandboxError(
  error: SandboxError | string | null | undefined
) {
  if (!error) return null;

  const message = typeof error === "string" ? error : error.message;
  const code =
    typeof error === "string" ? parseSandboxErrorCode(error) : error.code;

  const title =
    code === "GITHUB_NOT_CONNECTED"
      ? "Connect GitHub to launch this preview"
      : code === "VERCEL_CONNECTION_REQUIRED"
        ? "Connect your Vercel account to launch sandboxes"
        : code === "VERCEL_RECONNECT_REQUIRED"
          ? "Reconnect Vercel to launch this preview"
          : code === "VERCEL_PROJECT_REQUIRED"
            ? "Link a Vercel project to launch this preview"
            : code === "SANDBOX_SERVICE_UNAVAILABLE"
              ? "Sandbox service is unavailable"
              : "Sandbox launch failed";

  return {
    code,
    title,
    message,
    cta: SANDBOX_ERROR_CTA[code],
  };
}

export function shouldShowSandboxLaunchError({
  error,
  overlayStatus,
  stoppedOverlayLaunchAttemptId,
}: {
  error: SandboxError | null | undefined;
  overlayStatus: string;
  stoppedOverlayLaunchAttemptId?: string | null;
}) {
  if (!error) return false;
  // The record is actively serving traffic — a stored launch error from an
  // earlier attempt is stale and would pin an overlay over a working preview.
  if (overlayStatus === "running") return false;
  if (overlayStatus !== "stopped") return true;
  return Boolean(
    error.launchAttemptId &&
    stoppedOverlayLaunchAttemptId &&
    error.launchAttemptId === stoppedOverlayLaunchAttemptId
  );
}
