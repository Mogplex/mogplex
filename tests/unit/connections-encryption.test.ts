import assert from "node:assert/strict";
import test from "node:test";
import {
  ConnectionsEncryptionConfigError,
  decrypt,
  encrypt,
} from "../../lib/connections/encryption";

const ORIGINAL_KEY = process.env.CONNECTIONS_ENCRYPTION_KEY;

test.afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.CONNECTIONS_ENCRYPTION_KEY;
    return;
  }

  process.env.CONNECTIONS_ENCRYPTION_KEY = ORIGINAL_KEY;
});

test("connection encryption accepts quoted values with escaped newlines", () => {
  process.env.CONNECTIONS_ENCRYPTION_KEY = String.raw`"bc6c3a756366c4a0e1c4389b5387d8746ecad191b963c808a4fd9b3a9d454d8b\n"`;

  const ciphertext = encrypt("supabase-token");
  const plaintext = decrypt(ciphertext);

  assert.equal(plaintext, "supabase-token");
});

test("connection encryption rejects truly invalid keys", () => {
  process.env.CONNECTIONS_ENCRYPTION_KEY = "short";

  assert.throws(
    () => encrypt("anything"),
    (error: unknown) => error instanceof ConnectionsEncryptionConfigError
  );
});
