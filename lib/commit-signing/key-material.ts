/**
 * OpenSSH Ed25519 key material for commit signing.
 *
 * Git signs with an SSH key through `gpg.format=ssh`, which shells out to
 * `ssh-keygen`. That means the private key must be a real OpenSSH private
 * key file, not a PKCS#8 blob, so this module speaks the `openssh-key-v1`
 * container format directly instead of shelling out to `ssh-keygen`.
 *
 * Only unencrypted `ssh-ed25519` keys are handled: an encrypted key would
 * need a passphrase at every commit, which no sandbox can answer.
 */
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

const OPENSSH_KEY_TYPE = "ssh-ed25519";
const OPENSSH_MAGIC = "openssh-key-v1";
const PRIVATE_KEY_BEGIN = "-----BEGIN OPENSSH PRIVATE KEY-----";
const PRIVATE_KEY_END = "-----END OPENSSH PRIVATE KEY-----";
const ED25519_KEY_SIZE = 32;
const ED25519_PRIVATE_SIZE = 64;
const BASE64_LINE_LENGTH = 70;

export type CommitSigningKeyPair = {
  /** Armored OpenSSH private key, the file git signs with. */
  privateKey: string;
  /** `ssh-ed25519 AAAA... comment`, the value GitHub registers. */
  publicKey: string;
  /** `SHA256:...`, the same shape `ssh-keygen -lf` prints. */
  fingerprint: string;
};

export class CommitSigningKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitSigningKeyError";
  }
}

function encodeField(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length, 0);
  return Buffer.concat([length, value]);
}

function encodeText(value: string): Buffer {
  return encodeField(Buffer.from(value, "utf8"));
}

function wrapArmor(body: Buffer): string {
  const base64 = body.toString("base64");
  const lines: string[] = [];
  for (let index = 0; index < base64.length; index += BASE64_LINE_LENGTH) {
    lines.push(base64.slice(index, index + BASE64_LINE_LENGTH));
  }
  return [PRIVATE_KEY_BEGIN, ...lines, PRIVATE_KEY_END, ""].join("\n");
}

/** Public key blob: `string "ssh-ed25519"` + `string raw public key`. */
export function buildPublicKeyBlob(rawPublicKey: Buffer): Buffer {
  return Buffer.concat([
    encodeText(OPENSSH_KEY_TYPE),
    encodeField(rawPublicKey),
  ]);
}

/** `SHA256:` + unpadded base64 of the SHA-256 of the public key blob. */
export function fingerprintPublicKeyBlob(blob: Buffer): string {
  const digest = createHash("sha256").update(blob).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

export function formatPublicKeyLine(
  rawPublicKey: Buffer,
  comment: string
): string {
  const blob = buildPublicKeyBlob(rawPublicKey);
  const key = blob.toString("base64");
  return comment
    ? `${OPENSSH_KEY_TYPE} ${key} ${comment}`
    : `${OPENSSH_KEY_TYPE} ${key}`;
}

function decodeBase64Url(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

/** Build the `openssh-key-v1` container around an Ed25519 private key. */
function buildOpenSshPrivateKey(
  rawPublicKey: Buffer,
  rawPrivateKey: Buffer,
  comment: string
): string {
  const checkInt = randomBytes(4);
  const privateSection = Buffer.concat([
    checkInt,
    checkInt,
    encodeText(OPENSSH_KEY_TYPE),
    encodeField(rawPublicKey),
    encodeField(rawPrivateKey),
    encodeText(comment),
  ]);

  // The private section is padded to the cipher block size (8 for "none")
  // with 1, 2, 3, ... so a decoder can strip it deterministically.
  const paddingLength = (8 - (privateSection.length % 8)) % 8;
  const padding = Buffer.alloc(paddingLength);
  for (let index = 0; index < paddingLength; index++) {
    padding[index] = index + 1;
  }

  const publicBlob = buildPublicKeyBlob(rawPublicKey);
  const body = Buffer.concat([
    Buffer.from(`${OPENSSH_MAGIC}\0`, "binary"),
    encodeText("none"),
    encodeText("none"),
    encodeText(""),
    Buffer.from([0, 0, 0, 1]),
    encodeField(publicBlob),
    encodeField(Buffer.concat([privateSection, padding])),
  ]);

  return wrapArmor(body);
}

/**
 * Generate a fresh Ed25519 signing key in OpenSSH format.
 *
 * The private key is returned to the caller for encryption at rest; it is
 * never logged and never sent to the browser.
 */
export function generateCommitSigningKeyPair(
  comment = "mogplex-commit-signing"
): CommitSigningKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  if (!publicJwk.x || !privateJwk.d) {
    throw new CommitSigningKeyError("Could not export the Ed25519 key pair.");
  }
  const rawPublicKey = decodeBase64Url(publicJwk.x);
  const seed = decodeBase64Url(privateJwk.d);
  // OpenSSH stores the ed25519 private key as seed || public key.
  const rawPrivateKey = Buffer.concat([seed, rawPublicKey]);
  return {
    privateKey: buildOpenSshPrivateKey(rawPublicKey, rawPrivateKey, comment),
    publicKey: formatPublicKeyLine(rawPublicKey, comment),
    fingerprint: fingerprintPublicKeyBlob(buildPublicKeyBlob(rawPublicKey)),
  };
}

type Reader = {
  buffer: Buffer;
  offset: number;
};

function readField(reader: Reader): Buffer {
  if (reader.offset + 4 > reader.buffer.length) {
    throw new CommitSigningKeyError("The SSH key is truncated.");
  }
  const length = reader.buffer.readUInt32BE(reader.offset);
  reader.offset += 4;
  if (reader.offset + length > reader.buffer.length) {
    throw new CommitSigningKeyError("The SSH key is truncated.");
  }
  const value = reader.buffer.subarray(reader.offset, reader.offset + length);
  reader.offset += length;
  return value;
}

function readText(reader: Reader): string {
  return readField(reader).toString("utf8");
}

/** Reads a raw 4-byte big-endian integer (not a length-prefixed field). */
function readUint32(reader: Reader): number {
  if (reader.offset + 4 > reader.buffer.length) {
    throw new CommitSigningKeyError("The SSH key is truncated.");
  }
  const value = reader.buffer.readUInt32BE(reader.offset);
  reader.offset += 4;
  return value;
}

/**
 * Parse an armored OpenSSH private key and recover its public key.
 *
 * Returns `null` when the text is not an OpenSSH private key at all, and
 * throws when it is one Mogplex cannot use (wrong type, or passphrase
 * protected).
 */
export function parseOpenSshPrivateKey(
  armored: string
): { publicKey: string; fingerprint: string } | null {
  const trimmed = armored.trim();
  const begin = trimmed.indexOf(PRIVATE_KEY_BEGIN);
  const end = trimmed.indexOf(PRIVATE_KEY_END);
  if (begin === -1 || end === -1 || end < begin) return null;

  const base64 = trimmed
    .slice(begin + PRIVATE_KEY_BEGIN.length, end)
    .replace(/\s+/g, "");
  let body: Buffer;
  try {
    body = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (body.length === 0) return null;

  const magic = Buffer.from(`${OPENSSH_MAGIC}\0`, "binary");
  if (!body.subarray(0, magic.length).equals(magic)) return null;

  const reader: Reader = { buffer: body, offset: magic.length };
  const cipherName = readText(reader);
  const kdfName = readText(reader);
  readField(reader); // kdf options
  if (cipherName !== "none" || kdfName !== "none") {
    throw new CommitSigningKeyError(
      "Passphrase-protected SSH keys are not supported. Import an unencrypted key."
    );
  }
  const keyCount = readUint32(reader);
  if (keyCount !== 1) {
    throw new CommitSigningKeyError("Only single-key SSH files are supported.");
  }
  const publicBlob = readField(reader);
  const privateSection = readField(reader);

  const sectionReader: Reader = { buffer: privateSection, offset: 0 };
  const firstCheck = readUint32(sectionReader);
  const secondCheck = readUint32(sectionReader);
  if (firstCheck !== secondCheck) {
    throw new CommitSigningKeyError("The SSH key failed its integrity check.");
  }
  const keyType = readText(sectionReader);
  if (keyType !== OPENSSH_KEY_TYPE) {
    throw new CommitSigningKeyError(
      `Only ${OPENSSH_KEY_TYPE} signing keys are supported.`
    );
  }
  const rawPublicKey = readField(sectionReader);
  const rawPrivateKey = readField(sectionReader);
  if (rawPublicKey.length !== ED25519_KEY_SIZE) {
    throw new CommitSigningKeyError("The SSH key is not a valid Ed25519 key.");
  }
  if (rawPrivateKey.length !== ED25519_PRIVATE_SIZE) {
    throw new CommitSigningKeyError("The SSH key is not a valid Ed25519 key.");
  }
  const comment = readText(sectionReader);

  return {
    publicKey: formatPublicKeyLine(rawPublicKey, comment),
    fingerprint: fingerprintPublicKeyBlob(publicBlob),
  };
}

/** Parse an armored OpenSSH private key and reject anything unusable. */
export function readImportablePrivateKey(armored: string): {
  publicKey: string;
  fingerprint: string;
} {
  const parsed = parseOpenSshPrivateKey(armored);
  if (!parsed) {
    throw new CommitSigningKeyError(
      "That does not look like an OpenSSH private key (expected -----BEGIN OPENSSH PRIVATE KEY-----)."
    );
  }
  return parsed;
}
