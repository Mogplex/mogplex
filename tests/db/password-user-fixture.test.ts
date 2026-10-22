import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { verifyPassword } from "better-auth/crypto";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import { seedPasswordUser } from "../e2e/helpers/password-user";

it("seeds an existing password user against the real UUID auth schema", async () => {
  const db = new PGlite();
  try {
    const baseline = await readFile(
      new URL("../../neon/baseline.sql", import.meta.url),
      "utf8"
    );
    const profiles = baseline.match(
      /CREATE TABLE public\.profiles \([\s\S]*?\n\);/
    )?.[0];
    if (!profiles) throw new Error("Missing profiles baseline schema");
    await db.exec(profiles);
    for (const file of [
      "20260802000000_better_auth_foundation.sql",
      "20260802230000_profiles_reference_better_auth_user.sql",
      "20260814235500_enforce_password_hash_storage.sql",
    ]) {
      await db.exec(
        await readFile(
          new URL(`../../neon/migrations/${file}`, import.meta.url),
          "utf8"
        )
      );
    }
    // Adapt the database boundary only; execute the fixture's actual SQL.
    const pool = {
      connect: async () => ({
        query: (sql: string, values?: unknown[]) => db.query(sql, values),
        release: () => {},
      }),
    } as unknown as Pool;
    const email = "existing-fixture@e2e.mogplex.test";
    const password = "existing-fixture-password";
    const userId = await seedPasswordUser(pool, {
      email,
      password,
      verified: false,
    });
    const { rows } = await db.query<{
      email: string;
      emailVerified: boolean;
      accountId: string;
      providerId: string;
      password: string;
      profile_id: string;
      slug: string;
    }>(
      `select u.email, u."emailVerified", a."accountId", a."providerId", a.password, p.id as profile_id, p.slug
        from "user" u join account a on a."userId"=u.id join profiles p on p.auth_user_id=u.id
        where u.id=$1`,
      [userId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email,
      emailVerified: false,
      accountId: userId,
      providerId: "credential",
      slug: "existing-fixture",
    });
    expect(rows[0].profile_id).not.toBe(userId);
    expect(await verifyPassword({ hash: rows[0].password, password })).toBe(
      true
    );
  } finally {
    await db.close();
  }
});
