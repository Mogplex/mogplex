import { expect, it } from "vitest";
import type { supabaseAdmin } from "@/lib/supabase/admin";
import { GithubHttpError } from "@/lib/github-app";
import {
  listUserGithubInstallations,
  type UserGithubInstallation,
} from "./github-user-installations";

function database(
  rows: UserGithubInstallation[] | null,
  error: { message: string } | null = null
) {
  const query = {
    select: () => query,
    eq: async () => ({ data: rows, error }),
  };
  return { from: () => query } as unknown as typeof supabaseAdmin;
}
const known = {
  installation_id: 12,
  account_login: "approved",
  account_type: "Organization",
};
const unknown = {
  installation_id: 13,
  account_login: null,
  account_type: null,
};

it("returns attached grants and resolves missing owner metadata without discovering other installations", async () => {
  const ids: number[] = [];
  expect(
    await listUserGithubInstallations("user", {
      db: database([known, unknown]),
      getInstallation: async (id) => {
        ids.push(id);
        return { id, account: { login: "approved-two", type: "Organization" } };
      },
    })
  ).toEqual([
    known,
    { ...unknown, account_login: "approved-two", account_type: "Organization" },
  ]);
  expect(ids).toEqual([13]);
});
it("does not invent access for missing, malformed, revoked, or unidentifiable records", async () => {
  expect(
    await listUserGithubInstallations("user", { db: database(null) })
  ).toEqual([]);
  expect(
    await listUserGithubInstallations("user", {
      db: database([
        { ...known, installation_id: 0 },
        { ...known, installation_id: NaN },
      ]),
    })
  ).toEqual([]);
  expect(
    await listUserGithubInstallations("user", {
      db: database([unknown]),
      getInstallation: async () => ({ id: 13 }),
    })
  ).toEqual([]);
  for (const status of [401, 403, 404]) {
    expect(
      await listUserGithubInstallations("user", {
        db: database([unknown]),
        getInstallation: async () => {
          throw new GithubHttpError(status, "unavailable");
        },
      })
    ).toEqual([]);
  }
});
it("surfaces failed grant lookups instead of claiming that authorization is absent", async () => {
  await expect(
    listUserGithubInstallations("user", {
      db: database(null, { message: "database unavailable" }),
    })
  ).rejects.toThrow(
    "Failed to load GitHub installations: database unavailable"
  );
  await expect(
    listUserGithubInstallations("user", {
      db: database([unknown]),
      getInstallation: async () => {
        throw new GithubHttpError(503, "unavailable");
      },
    })
  ).rejects.toThrow();
});
