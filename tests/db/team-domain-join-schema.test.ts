import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";

const root = path.resolve(import.meta.dirname, "../..");
const migrationName = "20261021170000_team_domain_join.sql";

it("upgrades the real prior schema, preserves historical removals and domain identity, and audits atomically", async () => {
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  const scratch = await mkdtemp(
    path.join(tmpdir(), "mogplex-team-domain-schema-")
  );
  const owner = crypto.randomUUID();
  const removed = crypto.randomUUID();
  const team = crypto.randomUUID();
  async function account(id: string, email: string, verified = true) {
    await db.query(
      'insert into public."user" (id,name,email,"emailVerified","updatedAt") values ($1,$2,$3,$4,now())',
      [id, "Person", email, verified]
    );
    await db.query(
      "insert into public.profiles (id,auth_user_id,email) values ($1,$1,$2)",
      [id, email]
    );
  }
  const setting = (actor: string, enabled: boolean, domain: string | null) =>
    db.query("select public.set_team_signup_domain($1,$2,$3,$4)", [
      team,
      actor,
      enabled,
      domain,
    ]);
  try {
    const migrationsDir = path.join(root, "neon/migrations");
    for (const file of await readdir(migrationsDir)) {
      if (file.localeCompare(migrationName) < 0)
        await copyFile(
          path.join(migrationsDir, file),
          path.join(scratch, file)
        );
    }
    const previous = await applyNeonMigrations(db, {
      migrationsDir: scratch,
      baselinePath: path.join(root, "neon/baseline.sql"),
      log: () => {},
      warn: () => {},
    });
    expect(previous.ok).toBe(true);
    await account(owner, "owner@example.com");
    await account(removed, "removed@example.com");
    await db.query(
      "insert into public.teams (id,name,slug,owner_user_id) values ($1,$2,$3,$4)",
      [team, "Example", "domain-schema-team", owner]
    );
    await db.query(
      "insert into public.team_audit_events(team_id,actor_user_id,action,target_type,target_id) values ($1,$2,$3,$4,$5)",
      [team, owner, "member.removed", "member", removed]
    );
    // A current member who was once removed must not be treated as offboarded.
    await db.query(
      "insert into public.team_audit_events(team_id,actor_user_id,action,target_type,target_id) values ($1,$2,$3,$4,$5)",
      [team, owner, "member.removed", "member", owner]
    );
    await db.exec(
      await readFile(path.join(migrationsDir, migrationName), "utf8")
    );
    expect(
      (
        await db.query(
          "select user_id from public.team_domain_join_blocks where team_id=$1",
          [team]
        )
      ).rows
    ).toEqual([{ user_id: removed }]);
    await setting(owner, true, "example.com");
    await db.query("select public.enroll_verified_email_teams($1)", [removed]);
    expect(
      (
        await db.query(
          "select user_id from public.team_members where team_id=$1 and user_id=$2",
          [team, removed]
        )
      ).rows
    ).toEqual([]);

    const person = crypto.randomUUID();
    await account(person, "person@example.com", false);
    await db.query(
      'update public."user" set "emailVerified"=true where id=$1',
      [person]
    );
    const member = (
      await db.query<{ id: string; role: string; joined_at: string }>(
        "select id,role,joined_at from public.team_members where team_id=$1 and user_id=$2",
        [team, person]
      )
    ).rows[0];
    expect(member.role).toBe("developer");
    expect(member.id).toBeTruthy();
    expect(member.joined_at).toBeTruthy();
    expect(
      (
        await db.query(
          "select actor_member_id from public.team_audit_events where team_id=$1 and actor_user_id=$2 and action=$3",
          [team, person, "member.joined_by_domain"]
        )
      ).rows
    ).toEqual([{ actor_member_id: member.id }]);
    await setting(owner, false, "example.com");
    expect(
      (
        await db.query(
          "select signup_email_domain,signup_email_domain_enabled from public.teams where id=$1",
          [team]
        )
      ).rows
    ).toEqual([
      {
        signup_email_domain: "example.com",
        signup_email_domain_enabled: false,
      },
    ]);
    const admin = crypto.randomUUID();
    await account(admin, "admin@other.test");
    await db.query(
      "insert into public.team_members(team_id,user_id,role) values ($1,$2,$3)",
      [team, admin, "admin"]
    );
    await expect(setting(admin, true, "other.test")).rejects.toThrow(
      /signup_domain_mismatch/
    );

    await db.exec(
      "create function public.reject_signup_setting_audit() returns trigger language plpgsql as $$ begin if new.action = 'team.signup_domain.changed' then raise exception 'audit unavailable'; end if; return new; end; $$; create trigger reject_signup_setting_audit before insert on public.team_audit_events for each row execute function public.reject_signup_setting_audit();"
    );
    await expect(setting(owner, true, "example.com")).rejects.toThrow(
      /audit unavailable/
    );
    expect(
      (
        await db.query(
          "select signup_email_domain_enabled from public.teams where id=$1",
          [team]
        )
      ).rows
    ).toEqual([{ signup_email_domain_enabled: false }]);
  } finally {
    await db.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
