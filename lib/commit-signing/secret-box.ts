/**
 * Encryption at rest for commit signing private keys.
 *
 * The private key is stored encrypted with AES-256-GCM under a key derived
 * from a server-side secret. Without that secret the feature is disabled:
 * Mogplex fails closed for signing only — every other part of the platform
 * keeps working, and no key material is ever written to the database.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** Server-side secret that encrypts stored signing keys. */
export const COMMIT_SIGNING_ENCRYPTION_ENV =
  "MOGPLEX_COMMIT_SIGNING_KEY_ENCRYPTION_KEY";

const ENCRYPTION_VERSION = "v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class CommitSigningEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitSigningEncryptionError";
  }
}

/** True when the deployment can store commit signing keys at all. */
export function isCommitSigningEncryptionConfigured(): boolean {
  const secret = process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  return typeof secret === "string" && secret.trim().length > 0;
}

function resolveSecret(): string {
  const secret = process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new CommitSigningEncryptionError(
      `${COMMIT_SIGNING_ENCRYPTION_ENV} is not set, so commit signing keys cannot be stored.`
    );
  }
  return secret;
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypt a private key for storage.
 *
 * The payload is `v1.<base64(iv|auth tag|ciphertext)>`; the version prefix
 * leaves room to rotate the algorithm without a schema change.
 */
export function encryptCommitSigningSecret(plaintext: string): string {
  const key = deriveKey(resolveSecret());
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    Buffer.concat([iv, authTag, ciphertext]).toString("base64"),
  ].join(".");
}

/**
 * Decrypt a stored private key.
 *
 * Throws when the payload was tampered with, was encrypted under a
 * different secret, or was written by an unknown format version.
 */
export function decryptCommitSigningSecret(payload: string): string {
  const separator = payload.indexOf(".");
  if (separator === -1) {
    throw new CommitSigningEncryptionError(
      "The stored commit signing key is not in a supported format."
    );
  }
  const version = payload.slice(0, separator);
  if (version !== ENCRYPTION_VERSION) {
    throw new CommitSigningEncryptionError(
      `The stored commit signing key uses an unsupported format version (${version}).`
    );
  }
  const body = Buffer.from(payload.slice(separator + 1), "base64");
  if (body.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new CommitSigningEncryptionError(
      "The stored commit signing key is not in a supported format."
    );
  }
  const iv = body.subarray(0, IV_LENGTH);
  const authTag = body.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = body.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(resolveSecret()),
      iv
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CommitSigningEncryptionError(
      "The stored commit signing key could not be decrypted with this deployment's secret."
    );
  }
}
