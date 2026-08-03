// One-time production data copy for the Supabase → Neon flip.
//
// Copies identity (auth.users → better-auth "user" + github "account" rows),
// every public table's rows, the auth.users shim, and vault secrets from the
// live Supabase database into Neon. Provider icons are NOT copied — the
// twice-daily models sync repopulates storage_objects from provider logos on
// its first run after the flip.
//
// Existing users authenticated via GitHub OAuth only, so no credential
// (password) accounts are migrated — bcrypt hashes from Supabase wouldn't
// verify against better-auth's scrypt anyway. Their GitHub identities map to
// better-auth "account" rows so social sign-in links to the same uuid.
//
// Usage:
//   SUPABASE_DB_URL=postgres://... DATABASE_URL=postgres://... \
//     pnpm exec tsx scripts/copy-supabase-to-neon.ts [--dry-run] [--truncate]
//
// --dry-run  print the plan (table order + row counts) without writing
// --truncate empty each Neon target table before copying (required when
//            re-running after a partial copy)
import { Client } from "pg";

const BATCH_SIZE = 500;

// Neon-only tables that must never be overwritten from Supabase.
const NEON_ONLY_TABLES = new Set([
  "user",
  "session",
  "account",
  "verification",
  "ssoProvider",
  "storage_objects",
]);

type TableColumns = Map<string, string[]>;

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function listPublicTables(db: Client): Promise<string[]> {
  const { rows } = await db.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`
  );
  return rows.map((row) => String(row.tablename));
}

async function loadColumns(
  db: Client,
  tables: string[]
): Promise<TableColumns> {
  const { rows } = await db.query(
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public' and table_name = any($1)
     order by table_name, ordinal_position`,
    [tables]
  );
  const map: TableColumns = new Map();
  for (const row of rows) {
    const table = String(row.table_name);
    const cols = map.get(table) ?? [];
    cols.push(String(row.column_name));
    map.set(table, cols);
  }
  return map;
}

// Topological order by FK dependencies (parents before children). Cycles and
// self-references are broken arbitrarily — the copy also disables triggers/FK
// checks via session_replication_role when the role allows it.
async function topoOrder(db: Client, tables: string[]): Promise<string[]> {
  const { rows } = await db.query(
    `select conrelid::regclass::text as child, confrelid::regclass::text as parent
     from pg_constraint where contype = 'f'
       and connamespace = 'public'::regnamespace`
  );
  const clean = (name: string) =>
    name.replace(/^public\./, "").replaceAll('"', "");
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set()]));
  for (const row of rows) {
    const child = clean(String(row.child));
    const parent = clean(String(row.parent));
    if (child !== parent && deps.has(child) && deps.has(parent)) {
      deps.get(child)!.add(parent);
    }
  }
  const ordered: string[] = [];
  const placed = new Set<string>();
  let remaining = tables.filter((t) => deps.has(t));
  while (remaining.length > 0) {
    const ready = remaining.filter((t) =>
      [...deps.get(t)!].every((p) => placed.has(p))
    );
    const batch = ready.length > 0 ? ready : [remaining[0]]; // cycle-breaker
    for (const t of batch) {
      ordered.push(t);
      placed.add(t);
    }
    remaining = remaining.filter((t) => !placed.has(t));
  }
  return ordered;
}

async function copyTable(
  source: Client,
  target: Client,
  table: string,
  columns: string[],
  truncate: boolean
): Promise<number> {
  if (truncate) {
    await target.query(`delete from ${quoteIdent(table)}`);
  }
  const colList = columns.map(quoteIdent).join(", ");
  let offset = 0;
  let copied = 0;
  for (;;) {
    const { rows } = await source.query(
      `select ${colList} from ${quoteIdent(table)} order by 1 limit ${BATCH_SIZE} offset ${offset}`
    );
    if (rows.length === 0) break;
    const params: unknown[] = [];
    const tuples = rows.map((row) => {
      const placeholders = columns.map((col) => {
        const value = row[col];
        params.push(
          value !== null &&
            typeof value === "object" &&
            !(value instanceof Date) &&
            !Buffer.isBuffer(value)
            ? JSON.stringify(value)
            : value
        );
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await target.query(
      `insert into ${quoteIdent(table)} (${colList})
       select * from (values ${tuples.join(", ")}) as v(${colList})`,
      params
    );
    copied += rows.length;
    offset += rows.length;
  }
  return copied;
}

async function copyIdentity(source: Client, target: Client, truncate: boolean) {
  if (truncate) {
    await target.query(`delete from "account"`);
    await target.query(`delete from "session"`);
    await target.query(`delete from "user"`);
  }
  const { rows: users } = await source.query(
    `select id, email, coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', email) as name,
            raw_user_meta_data->>'avatar_url' as image,
            email_confirmed_at is not null as verified,
            created_at
     from auth.users`
  );
  for (const user of users) {
    await target.query(
      `insert into "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict ("id") do nothing`,
      [
        user.id,
        user.name,
        user.email,
        user.verified,
        user.image,
        user.created_at,
      ]
    );
  }
  const { rows: identities } = await source.query(
    `select user_id, provider,
            coalesce(provider_id, identity_data->>'sub') as account_id,
            created_at
     from auth.identities where provider <> 'email'`
  );
  for (const identity of identities) {
    await target.query(
      `insert into "account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
       values (gen_random_uuid()::text, $1, $2, $3, $4, now())
       on conflict ("id") do nothing`,
      [
        identity.account_id,
        identity.provider,
        identity.user_id,
        identity.created_at,
      ]
    );
  }
  return { users: users.length, identities: identities.length };
}

async function copyAuthUsersShim(
  source: Client,
  target: Client,
  truncate: boolean
) {
  if (truncate) await target.query(`delete from auth.users`);
  const { rows } = await source.query(
    `select id, email, raw_user_meta_data from auth.users`
  );
  for (const row of rows) {
    await target.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, $2, $3) on conflict (id) do nothing`,
      [row.id, row.email, row.raw_user_meta_data]
    );
  }
  return rows.length;
}

async function copyVaultSecrets(source: Client, target: Client) {
  // Neon's vault is the plaintext shim table; Supabase decrypts via the
  // decrypted_secrets view. Idempotent on name.
  const { rows } = await source.query(
    `select id, name, description, decrypted_secret, created_at, updated_at
     from vault.decrypted_secrets`
  );
  for (const row of rows) {
    await target.query(
      `insert into vault.secrets (id, name, description, secret, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set secret = excluded.secret, updated_at = excluded.updated_at`,
      [
        row.id,
        row.name,
        row.description,
        row.decrypted_secret,
        row.created_at,
        row.updated_at,
      ]
    );
  }
  return rows.length;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const truncate = process.argv.includes("--truncate");
  const supabaseUrl = process.env.SUPABASE_DB_URL;
  const neonUrl = process.env.DATABASE_URL;
  if (!supabaseUrl || !neonUrl) {
    console.error("Set SUPABASE_DB_URL and DATABASE_URL");
    process.exitCode = 1;
    return;
  }

  const source = new Client({ connectionString: supabaseUrl });
  const target = new Client({ connectionString: neonUrl });
  await source.connect();
  await target.connect();

  try {
    const sourceTables = await listPublicTables(source);
    const targetTables = new Set(await listPublicTables(target));
    const tables = sourceTables.filter(
      (t) => !NEON_ONLY_TABLES.has(t) && targetTables.has(t)
    );
    const missing = sourceTables.filter(
      (t) => !NEON_ONLY_TABLES.has(t) && !targetTables.has(t)
    );
    if (missing.length > 0) {
      console.error(`Neon is missing tables: ${missing.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const ordered = await topoOrder(source, tables);
    const columns = await loadColumns(source, ordered);

    if (dryRun) {
      for (const table of ordered) {
        const { rows } = await source.query(
          `select count(*)::int as n from ${quoteIdent(table)}`
        );
        console.log(`${table}: ${rows[0].n} rows`);
      }
      console.log(
        `${ordered.length} tables in copy order; identity + vault + auth shim additionally`
      );
      return;
    }

    // Best-effort: disables FK/trigger enforcement during the copy so cycle
    // breaks and notify triggers don't interfere. Falls back silently when
    // the role lacks permission (copy order still mostly satisfies FKs).
    await target.query(`set session_replication_role = replica`).catch(() => {
      console.warn(
        "session_replication_role not permitted — relying on FK order"
      );
    });

    const identity = await copyIdentity(source, target, truncate);
    console.log(
      `identity: ${identity.users} users, ${identity.identities} oauth accounts`
    );
    const shim = await copyAuthUsersShim(source, target, truncate);
    console.log(`auth.users shim: ${shim} rows`);

    for (const table of ordered) {
      const copied = await copyTable(
        source,
        target,
        table,
        columns.get(table) ?? [],
        truncate
      );
      console.log(`${table}: ${copied} rows`);
    }

    const vault = await copyVaultSecrets(source, target);
    console.log(`vault secrets: ${vault}`);

    await target
      .query(`set session_replication_role = default`)
      .catch(() => undefined);

    // Row-count validation.
    let mismatches = 0;
    for (const table of ordered) {
      const [{ rows: a }, { rows: b }] = await Promise.all([
        source.query(`select count(*)::int as n from ${quoteIdent(table)}`),
        target.query(`select count(*)::int as n from ${quoteIdent(table)}`),
      ]);
      if (a[0].n !== b[0].n) {
        mismatches += 1;
        console.error(
          `COUNT MISMATCH ${table}: supabase=${a[0].n} neon=${b[0].n}`
        );
      }
    }
    console.log(
      mismatches === 0
        ? "row counts match on every table"
        : `${mismatches} mismatched tables`
    );
    if (mismatches > 0) process.exitCode = 1;
  } finally {
    await source.end();
    await target.end();
  }
}

// Top-level await is unavailable under the repo tsconfig's module setting.
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
