import { describe, expect, it } from "vitest";
import {
  installRepo,
  REPO_ID,
  tools,
} from "../../../tests/support/project-settings-fixture";

describe("project_env_request", () => {
  it("should ask for variables by name and report which are missing", async () => {
    const { writes } = installRepo();

    const result = await tools().project_env_request.execute({
      names: [" STRIPE_SECRET_KEY ", "DATABASE_URL", "STRIPE_SECRET_KEY"],
      reason: "Checkout needs Stripe.",
    });

    expect(result).toMatchObject({
      ok: true,
      repoId: REPO_ID,
      requested: ["STRIPE_SECRET_KEY", "DATABASE_URL"],
      missing: ["STRIPE_SECRET_KEY"],
      reason: "Checkout needs Stripe.",
    });
    expect(JSON.stringify(result)).not.toContain("postgres://");
    expect(writes).toEqual([]);
  });

  it("should refuse an invalid name in a variable request", async () => {
    installRepo();

    expect(
      await tools().project_env_request.execute({ names: ["OK", "NOT-OK"] })
    ).toEqual({ error: "NOT-OK is not a valid variable name." });
  });

  it("should let a team viewer ask for variables", async () => {
    installRepo({
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    });

    expect(
      await tools("team-1", "viewer").project_env_request.execute({
        names: ["API_KEY"],
      })
    ).toMatchObject({ ok: true, missing: ["API_KEY"] });
  });
});
