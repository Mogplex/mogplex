/**
 * Re-encrypt `connections.encrypted_credentials` under a new
 * CONNECTIONS_ENCRYPTION_KEY. See docs/security/connections-key-rotation.md
 * for the full rotation procedure this script is part of.
 *
 * Runs against the serving database (Neon) over DATABASE_URL — NOT the
 * retired Supabase project. Rotating anywhere other than the database the
 * app reads from would leave production ciphertexts undecryptable after the
 * env-var key flip.
 *
 * Usage:
 *   OLD_CONNECTIONS_ENCRYPTION_KEY=... \
 *   NEW_CONNECTIONS_ENCRYPTION_KEY=... \
 *   DATABASE_URL=... \
 *     npx tsx scripts/rotate-connections-encryption-key.ts [--execute]
 *
 * Dry-run by default: reports what would change without writing. Pass
 * --execute to persist. A JSON backup of every original ciphertext is
 * written to scripts/.rotation-backup-<timestamp>.json (gitignored path
 * pattern; delete after verifying the rotation). Rows whose ciphertext
 * changes between read and write are skipped and reported — the run exits
 * non-zero so automation can't treat an incomplete rotation as done; re-run
 * the script to pick them up.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Pool } from "pg";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function normalizeHexKey(raw: string | undefined): Buffer {
  const trimmed = (raw ?? "").trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  const hex = unquoted.replace(/\\n/g, "").replace(/\s+/g, "");
  if (!/^[\dA-Fa-f]{64}$/.test(hex)) {
    throw new Error("key must be 64 hex chars (after normalization)");
  }
  return Buffer.from(hex, "hex");
}

function decryptWith(key: Buffer, ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}

function encryptWith(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

async function main() {
  const execute = process.argv.includes("--execute");
  const oldKey = normalizeHexKey(process.env.OLD_CONNECTIONS_ENCRYPTION_KEY);
  const newKey = normalizeHexKey(process.env.NEW_CONNECTIONS_ENCRYPTION_KEY);
  if (oldKey.equals(newKey)) {
    throw new Error("old and new keys are identical");
  }
  const databaseUrl =
    process.env.DATABASE_URL || process.env.mogplex_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (the serving Neon database)");
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    // Plain SQL over pg: one statement returns every row — no PostgREST-style
    // page cap that could silently rotate only part of the table. The count
    // cross-check still guards against anything truncating the result set.
    const [{ rows }, countResult] = await Promise.all([
      pool.query(
        `select id, encrypted_credentials from connections
         where encrypted_credentials is not null`
      ),
      pool.query(
        `select count(*)::int as total from connections
         where encrypted_credentials is not null`
      ),
    ]);
    const expected = countResult.rows[0]?.total as number;
    if (rows.length !== expected) {
      throw new Error(
        `row fetch is incomplete: got ${rows.length}, table has ${expected} — aborting before any writes`
      );
    }

    const backupPath = `scripts/.rotation-backup-${Date.now()}.json`;
    if (execute) {
      writeFileSync(backupPath, JSON.stringify(rows, null, 2), { mode: 0o600 });
      console.log(`backed up ${rows.length} ciphertexts to ${backupPath}`);
    }

    let rotated = 0;
    let alreadyNew = 0;
    const failed: string[] = [];
    const raced: string[] = [];

    for (const row of rows) {
      const original = row.encrypted_credentials as string;
      let plaintext: string;
      try {
        plaintext = decryptWith(oldKey, original);
      } catch {
        try {
          decryptWith(newKey, original);
          alreadyNew += 1;
          continue;
        } catch {
          failed.push(row.id as string);
          continue;
        }
      }

      const next = encryptWith(newKey, plaintext);
      if (decryptWith(newKey, next) !== plaintext) {
        throw new Error(`round-trip verification failed for row ${row.id}`);
      }

      if (execute) {
        const updated = await pool.query(
          `update connections set encrypted_credentials = $1
           where id = $2 and encrypted_credentials = $3
           returning id`,
          [next, row.id, original]
        );
        if (updated.rowCount === 0) {
          raced.push(row.id as string);
          continue;
        }
      }
      rotated += 1;
    }

    const mode = execute ? "rotated" : "would rotate (dry run)";
    console.log(
      `${mode}: ${rotated} | already on new key: ${alreadyNew} | undecryptable: ${failed.length} | changed mid-run (re-run needed): ${raced.length}`
    );
    if (failed.length > 0) {
      console.log(`undecryptable row ids: ${failed.join(", ")}`);
    }
    if (raced.length > 0) {
      console.log(`raced row ids: ${raced.join(", ")}`);
    }
    if (!execute) {
      console.log("no writes performed — re-run with --execute to persist");
    }
    // Raced rows mean the rotation is definitionally incomplete — surface it
    // in the exit code, not just the summary line.
    if (failed.length > 0 || raced.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
