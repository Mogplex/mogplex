/**
 * Validates CLI callback URLs for the browser-based auth flow.
 *
 * Security constraints:
 * - Must be http:// or https://
 * - Host must be localhost or 127.0.0.1
 * - Port must be numeric (1024-65535)
 * - Nonce must be 32 hex characters (16 random bytes, hex-encoded)
 */

export interface ValidatedCallback {
  /** Normalized callback URL */
  url: string;
  /** Port the CLI is listening on */
  port: number;
  /** Nonce for CSRF protection */
  nonce: string;
}

export type CallbackValidationResult = ValidatedCallback | { error: string };

// The CLI produces `randomBytes(16).toString("hex")`, which is 32 hex chars.
// Historically this pattern accepted 16 chars, which silently rejected every
// real CLI login — keep it aligned with the CLI's output.
const NONCE_PATTERN = /^[a-f0-9]{32}$/i;

/**
 * Validate and normalize a CLI callback URL.
 *
 * @param params - callback URL and nonce from query params
 * @returns ValidatedCallback if valid, or { error } if invalid
 */
export function validateCliCallback(params: {
  callback: string | null;
  nonce: string | null;
}): CallbackValidationResult {
  const { callback, nonce } = params;

  // Validate callback URL exists
  if (!callback) {
    return { error: "Missing callback parameter" };
  }

  // Validate nonce exists and is correct format
  if (!nonce) {
    return { error: "Missing nonce parameter" };
  }
  if (!NONCE_PATTERN.test(nonce)) {
    return { error: "Invalid nonce format (expected 32 hex characters)" };
  }

  // Parse callback URL
  let parsed: URL;
  try {
    parsed = new URL(callback);
  } catch {
    return { error: "Invalid callback URL" };
  }

  // Validate protocol
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Callback must use http or https protocol" };
  }

  // Validate host is localhost
  const host = parsed.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") {
    return { error: "Callback host must be localhost or 127.0.0.1" };
  }

  // Validate port is numeric and in valid range
  const portStr = parsed.port;
  if (!portStr) {
    return { error: "Callback must include a port number" };
  }
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1024 || port > 65535) {
    return { error: "Callback port must be between 1024 and 65535" };
  }

  // Normalize the URL
  const normalizedUrl = `${parsed.protocol}//${parsed.hostname}:${port}${parsed.pathname}${parsed.search}`;

  return {
    url: normalizedUrl,
    port,
    nonce,
  };
}
