import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class ConnectionsEncryptionConfigError extends Error {
  code = "CONNECTIONS_UNAVAILABLE";

  constructor() {
    super("Connection credential encryption is not configured correctly");
    this.name = "ConnectionsEncryptionConfigError";
  }
}

function normalizeHexKey(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;

  return unquoted.replace(/\\n/g, "").replace(/\s+/g, "");
}

function getKey(): Buffer {
  const hex = normalizeHexKey(process.env.CONNECTIONS_ENCRYPTION_KEY);
  if (!/^[\dA-Fa-f]{64}$/.test(hex)) {
    throw new ConnectionsEncryptionConfigError();
  }
  return Buffer.from(hex, "hex");
}

export function isConnectionsEncryptionConfigError(
  error: unknown
): error is ConnectionsEncryptionConfigError {
  return error instanceof ConnectionsEncryptionConfigError;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // iv (12) + tag (16) + ciphertext → single base64 string
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
