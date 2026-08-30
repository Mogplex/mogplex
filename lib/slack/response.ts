/**
 * Hosts Slack uses for signed interaction response URLs. The test host keeps
 * fixtures offline while preserving the same fail-closed boundary.
 */
const ALLOWED_RESPONSE_URL_HOSTS = new Set([
  "hooks.slack.com",
  "hooks.slack.test",
]);

function assertAllowedResponseUrl(responseUrl: string): void {
  let host: string;
  try {
    host = new URL(responseUrl).hostname;
  } catch {
    throw new Error(`Invalid Slack response_url: ${responseUrl}`);
  }
  if (!ALLOWED_RESPONSE_URL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to POST Slack response_url to unexpected host: ${host}`
    );
  }
}

export async function postSlackResponse(
  responseUrl: string,
  body: Record<string, unknown>
): Promise<void> {
  assertAllowedResponseUrl(responseUrl);
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Slack response_url POST failed: HTTP ${response.status}`);
  }
}
