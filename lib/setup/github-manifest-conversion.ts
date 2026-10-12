/**
 * Redeems a GitHub App manifest code for the new App's credentials.
 * https://docs.github.com/en/rest/apps/apps#create-a-github-app-from-a-manifest
 */

export type GithubManifestApp = {
  id: number;
  slug: string;
  name: string;
  htmlUrl: string;
  pem: string;
  webhookSecret: string | null;
};

export type GithubManifestConversionResult =
  | { ok: true; app: GithubManifestApp }
  | {
      ok: false;
      reason:
        | "invalid_code"
        | "expired_code"
        | "github_error"
        | "invalid_response";
    };

const MANIFEST_CODE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Narrows GitHub's conversion response to the fields setup needs. */
export function parseGithubManifestConversion(
  value: unknown
): GithubManifestApp | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.id !== "number" ||
    !Number.isInteger(body.id) ||
    !nonEmptyString(body.slug) ||
    !nonEmptyString(body.pem) ||
    !nonEmptyString(body.html_url)
  ) {
    return null;
  }
  return {
    id: body.id,
    slug: body.slug,
    name: nonEmptyString(body.name) ? body.name : body.slug,
    htmlUrl: body.html_url,
    pem: body.pem,
    webhookSecret: nonEmptyString(body.webhook_secret)
      ? body.webhook_secret
      : null,
  };
}

export async function exchangeGithubManifestCode(
  code: string | null | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<GithubManifestConversionResult> {
  if (!code || !MANIFEST_CODE_PATTERN.test(code)) {
    return { ok: false, reason: "invalid_code" };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/app-manifests/${code}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );
  } catch {
    return { ok: false, reason: "github_error" };
  }

  // GitHub answers 404 for a code that was already used or has expired.
  if (response.status === 404 || response.status === 422) {
    return { ok: false, reason: "expired_code" };
  }
  if (!response.ok) return { ok: false, reason: "github_error" };

  const app = parseGithubManifestConversion(
    await response.json().catch(() => null)
  );
  return app ? { ok: true, app } : { ok: false, reason: "invalid_response" };
}

function quoteEnvValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The `.env` lines for the new App. The private key is written on one line
 * with `\n` escapes, the form `lib/github-app.ts` reads.
 */
export function formatGithubAppEnvBlock(app: GithubManifestApp): string {
  const pem = app.pem.trim().replace(/\r?\n/g, String.raw`\n`);
  return [
    `GITHUB_APP_ID=${app.id}`,
    `GITHUB_APP_NAME=${app.slug}`,
    `GITHUB_APP_PRIVATE_KEY="${pem}${String.raw`\n`}"`,
    app.webhookSecret
      ? `GITHUB_WEBHOOK_SECRET=${quoteEnvValue(app.webhookSecret)}`
      : "# GITHUB_WEBHOOK_SECRET: set a webhook secret in the App settings, then add it here.",
  ].join("\n");
}
