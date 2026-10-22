import crypto from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Pool } from "pg";

// Existing password users remain supported after public email signup closes.
// Seed their stored state directly so login/recovery tests cannot reopen signup.
export async function seedPasswordUser(
  pool: Pool,
  {
    email,
    password,
    verified = true,
  }: {
    email: string;
    password: string;
    verified?: boolean;
  }
): Promise<string> {
  const userId = crypto.randomUUID();
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'E2E Password User', $2, $3, now(), now())`,
      [userId, email, verified]
    );
    await client.query(
      `insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       values ($1, $2, 'credential', $2, $3, now(), now())`,
      [crypto.randomUUID(), userId, hash]
    );
    await client.query(
      `insert into profiles (id, auth_user_id, email, name, slug)
       values ($1, $2, $3, 'E2E Password User', $4)`,
      [crypto.randomUUID(), userId, email, email.split("@")[0]]
    );
    await client.query("commit");
    return userId;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
