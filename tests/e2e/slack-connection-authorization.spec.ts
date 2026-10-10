import { expect, test } from "@playwright/test";

test("an invalid connector link gives Slack recovery guidance without starting authorization", async ({
  page,
}) => {
  await page.goto("/slack/connections?request=invalid");
  await expect(
    page.getByRole("heading", { name: "Connection request unavailable" })
  ).toBeVisible();
  await expect(
    page.getByText("Open the connector card in Slack to start authorization.")
  ).toBeVisible();
  await expect(page).toHaveURL(/\/slack\/connections\?request=invalid/);
});

test("a signed-out connector requester signs in before provider authorization and retains the request", async ({
  page,
}) => {
  const id = "00000000-0000-4000-8000-000000000001";
  await page.goto(`/slack/connections?request=${id}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(
    `/slack/connections?request=${id}`
  );
  await expect(page.getByRole("button", { name: /github/i })).toBeVisible();
});
