import assert from "node:assert/strict";
import { test } from "vitest";
import {
  COMMIT_SIGNING_ENCRYPTION_ENV,
  CommitSigningEncryptionError,
  decryptCommitSigningSecret,
  encryptCommitSigningSecret,
  isCommitSigningEncryptionConfigured,
} from "./secret-box";

const PRIVATE_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

test("a signing secret survives a round trip", () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "test-secret-value";
  try {
    const payload = encryptCommitSigningSecret(PRIVATE_KEY);
    assert.ok(payload.startsWith("v1."));
    assert.ok(!payload.includes("BEGIN OPENSSH PRIVATE KEY"));
    assert.equal(decryptCommitSigningSecret(payload), PRIVATE_KEY);
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});

test("each encryption uses a fresh nonce", () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "test-secret-value";
  try {
    assert.notEqual(
      encryptCommitSigningSecret(PRIVATE_KEY),
      encryptCommitSigningSecret(PRIVATE_KEY)
    );
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});

test("a secret encrypted under another deployment secret cannot be read", () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "first-secret";
  const payload = encryptCommitSigningSecret(PRIVATE_KEY);
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "second-secret";
  try {
    assert.throws(
      () => decryptCommitSigningSecret(payload),
      CommitSigningEncryptionError
    );
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});

test("a tampered payload is rejected", () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "test-secret-value";
  try {
    const payload = encryptCommitSigningSecret(PRIVATE_KEY);
    const tampered = `${payload.slice(0, -2)}AA`;
    assert.throws(
      () => decryptCommitSigningSecret(tampered),
      CommitSigningEncryptionError
    );
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});

test("a missing encryption secret fails closed", () => {
  delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  assert.equal(isCommitSigningEncryptionConfigured(), false);
  assert.throws(
    () => encryptCommitSigningSecret(PRIVATE_KEY),
    CommitSigningEncryptionError
  );
  assert.throws(
    () => decryptCommitSigningSecret("v1.abc"),
    CommitSigningEncryptionError
  );
});

test("an unknown payload version is rejected", () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "test-secret-value";
  try {
    assert.throws(
      () => decryptCommitSigningSecret("v9.abc"),
      CommitSigningEncryptionError
    );
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});
