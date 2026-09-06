import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { buildE2EAuthHeaders } from "./helpers/auth";

// Explicit test DB only. Do not discover a production connection in .env.local.
const databaseUrl = process.env.DATABASE_URL;

test("Neon invitations use the current profile and preserve email-mismatch confirmation", async ({
  page,
}) => {
  test.skip(!databaseUrl, "An explicit DATABASE_URL test database is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const profileId = randomUUID();
  const teamId = randomUUID();
  const inviteId = randomUUID();
  const token = randomUUID();
  const email = `invite-${profileId}@example.test`;
  try {
    await pool.query("insert into profiles (id, email) values ($1, $2)", [
      profileId,
      email,
    ]);
    await pool.query(
      "insert into teams (id, name, slug, owner_user_id) values ($1, 'Neon test team', $2, $3)",
      // Keep the unique fixture slug within the schema's 39-character limit.
      [teamId, `neon-${teamId.replaceAll("-", "")}`, profileId]
    );
    await pool.query(
      "insert into team_invites (id, token, team_id, email, role) values ($1, $2, $3, $4, 'viewer')",
      [inviteId, token, teamId, email]
    );
    await page.context().setExtraHTTPHeaders(buildE2EAuthHeaders(profileId));
    await page.goto(`/invite/${token}`);
    await expect(
      page.getByRole("heading", { name: "Join Neon test team on Mogplex" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Accept invitation" })
    ).toBeEnabled();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    // Distinct auth and profile identities: the fixture has no Supabase auth
    // user. Only the resolved profile id is allowed to select this email.
    await pool.query(
      "update team_invites set email = 'different@example.test' where id = $1",
      [inviteId]
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Accept invitation" })
    ).toBeDisabled();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.getByRole("checkbox").check();
    await expect(
      page.getByRole("button", { name: "Accept invitation" })
    ).toBeEnabled();
    // No acceptance write: this test verifies rendering and identity only.
  } finally {
    await pool.query("delete from team_invites where id = $1", [inviteId]);
    await pool.query("delete from teams where id = $1", [teamId]);
    await pool.query("delete from profiles where id = $1", [profileId]);
    await pool.end();
  }
});
