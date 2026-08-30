import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION_NAME = "20260830190000_atomic_invite_acceptance.sql";
const TEAM_ID = "00000000-0000-4000-8000-000000000001";
const INVITER_ID = "00000000-0000-4000-8000-000000000002";
const FIRST_USER_ID = "00000000-0000-4000-8000-000000000003";
const SECOND_USER_ID = "00000000-0000-4000-8000-000000000004";

async function createSeededDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create table public.profiles (
      id uuid primary key,
      email text
    );
    create table public.teams (
      id uuid primary key,
      slug text not null
    );
    create table public.team_members (
      team_id uuid not null references public.teams(id) on delete cascade,
      user_id uuid not null references public.profiles(id) on delete cascade,
      role text not null,
      invited_by_user_id uuid references public.profiles(id) on delete set null,
      primary key (team_id, user_id)
    );
    create table public.team_invites (
      id uuid primary key,
      team_id uuid not null references public.teams(id) on delete cascade,
      email text not null,
      role text not null,
      token text not null unique,
      invited_by_user_id uuid references public.profiles(id) on delete set null,
      expires_at timestamptz not null,
      accepted_at timestamptz
    );

    insert into public.profiles (id, email) values
      ('${INVITER_ID}', 'owner@example.com'),
      ('${FIRST_USER_ID}', 'first@example.com'),
      ('${SECOND_USER_ID}', 'second@example.com');
    insert into public.teams (id, slug) values ('${TEAM_ID}', 'builders');
  `);

  const sql = await readFile(
    path.join(REPO_ROOT, "supabase/migrations", MIGRATION_NAME),
    "utf8"
  );
  await db.exec(sql);
  return db;
}

async function insertInvite(db: PGlite, input: { id: string; token: string }) {
  await db.exec(`
    insert into public.team_invites (
      id, team_id, email, role, token, invited_by_user_id, expires_at
    ) values (
      '${input.id}', '${TEAM_ID}', 'recipient@example.com', 'developer',
      '${input.token}', '${INVITER_ID}', now() + interval '1 day'
    )
  `);
}

describe("atomic invite acceptance migration", () => {
  it("keeps the production migration ledgers identical", async () => {
    const [neon, supabase] = await Promise.all([
      readFile(path.join(REPO_ROOT, "neon/migrations", MIGRATION_NAME), "utf8"),
      readFile(
        path.join(REPO_ROOT, "supabase/migrations", MIGRATION_NAME),
        "utf8"
      ),
    ]);
    expect(neon).toBe(supabase);
  });

  it("allows exactly one confirmed mismatch claimant", async () => {
    const db = await createSeededDb();
    try {
      await insertInvite(db, {
        id: "00000000-0000-4000-8000-000000000010",
        token: "single-use-token",
      });

      const attempts = await Promise.allSettled([
        db.query(`select * from public.accept_team_invite($1, $2, $3)`, [
          "single-use-token",
          FIRST_USER_ID,
          true,
        ]),
        db.query(`select * from public.accept_team_invite($1, $2, $3)`, [
          "single-use-token",
          SECOND_USER_ID,
          true,
        ]),
      ]);

      expect(
        attempts.filter((attempt) => attempt.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        attempts.filter((attempt) => attempt.status === "rejected")
      ).toHaveLength(1);

      const members = await db.query<{ user_id: string }>(`
        select user_id from public.team_members where team_id = '${TEAM_ID}'
      `);
      expect(members.rows).toHaveLength(1);
      const invite = await db.query<{ accepted_at: string | null }>(`
        select accepted_at from public.team_invites where token = 'single-use-token'
      `);
      expect(invite.rows[0]?.accepted_at).not.toBeNull();
    } finally {
      await db.close();
    }
  });

  it("rolls back the invite claim when membership creation fails", async () => {
    const db = await createSeededDb();
    try {
      await insertInvite(db, {
        id: "00000000-0000-4000-8000-000000000011",
        token: "rollback-token",
      });
      await db.exec(`
        create function public.reject_test_member()
        returns trigger language plpgsql as $$
        begin
          if new.user_id = '${FIRST_USER_ID}' then
            raise exception 'membership rejected';
          end if;
          return new;
        end;
        $$;
        create trigger reject_test_member
          before insert on public.team_members
          for each row execute function public.reject_test_member();
      `);

      await expect(
        db.query(`select * from public.accept_team_invite($1, $2, $3)`, [
          "rollback-token",
          FIRST_USER_ID,
          true,
        ])
      ).rejects.toThrow(/membership rejected/);

      const invite = await db.query<{ accepted_at: string | null }>(`
        select accepted_at from public.team_invites where token = 'rollback-token'
      `);
      expect(invite.rows[0]?.accepted_at).toBeNull();
    } finally {
      await db.close();
    }
  });
});
