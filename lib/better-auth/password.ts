import {
  hashPassword as hashWithScrypt,
  verifyPassword as verifyWithScrypt,
} from "better-auth/crypto";

export const ACCOUNT_PASSWORD_HASH_PATTERN = /^[0-9a-f]{32}:[0-9a-f]{128}$/;

export function isAccountPasswordHash(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_PASSWORD_HASH_PATTERN.test(value);
}

export async function hashAccountPassword(password: string): Promise<string> {
  return hashWithScrypt(password);
}

export async function verifyAccountPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!isAccountPasswordHash(hash)) {
    // Match the cost of a real verification so a malformed legacy row does
    // not become a useful account-enumeration timing signal.
    await hashWithScrypt(password);
    return false;
  }
  return verifyWithScrypt({ hash, password });
}
