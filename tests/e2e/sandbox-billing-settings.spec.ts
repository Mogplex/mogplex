import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";

test("retired personal Vercel and migration endpoints return not found", async ({
  request,
}) => {
  const headers = buildE2EAuthHeaders();
  const targets = await request.get("/api/vercel/targets", { headers });
  expect(targets.status()).toBe(404);

  const createProject = await request.post("/api/vercel/targets", {
    headers,
    data: { name: "must-not-create" },
  });
  expect(createProject.status()).toBe(404);

  const migration = await request.post("/api/migrate", { headers });
  expect(migration.status()).toBe(404);
});
