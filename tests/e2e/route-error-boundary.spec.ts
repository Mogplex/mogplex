import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("Try again refetches a recovered server page and retains navigation", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/repos**", (route) => fulfillJson(route, []));
  await page.route("**/api/agents**", (route) => fulfillJson(route, []));
  await page.goto(`${scopedPath("agents")}?routeError=server`);
  await expect(
    page.getByText("Something went wrong", { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId("dashboard-shell")).toBeVisible();
  await expect(page.getByText(/^Reference: /)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    "Private server database fixture failure"
  );
  await page.context().addCookies([
    {
      name: "mogplex-e2e-route-recovered",
      value: "1",
      url: new URL(page.url()).origin,
    },
  ]);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New Agent", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Something went wrong", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Command Center", exact: true })
  ).toBeVisible();
});

test("page failure preserves the shell, reports to Sentry, hides details, and retries", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/repos**", (route) => fulfillJson(route, []));
  await page.route("**/api/agents**", (route) => fulfillJson(route, []));
  let reportException: (envelope: unknown) => void = () => {};
  const sentryException = new Promise<unknown>((resolve) => {
    reportException = resolve;
  });
  await page.exposeFunction(
    "captureRouteErrorEnvelope",
    (envelope: unknown) => {
      if (JSON.stringify(envelope).includes("Private database fixture failure"))
        reportException(envelope);
    }
  );
  await page.addInitScript(() => {
    window.addEventListener("mogplex-e2e-sentry", (event) => {
      if (
        "captureRouteErrorEnvelope" in window &&
        typeof window.captureRouteErrorEnvelope === "function"
      ) {
        void window.captureRouteErrorEnvelope((event as CustomEvent).detail);
      }
    });
  });
  await page.goto(`${scopedPath("agents")}?routeError=1`);
  await expect(
    page.getByText("Something went wrong", { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId("dashboard-shell")).toBeVisible();
  await expect(page.getByRole("link", { name: "Mogplex home" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Command Center", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Private database fixture failure", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText("Reference: route-fixture-422", { exact: true })
  ).toBeVisible();
  expect(JSON.stringify(await sentryException)).toContain(
    "Private database fixture failure"
  );
  await page.evaluate(() =>
    window.sessionStorage.setItem("mogplex-e2e-route-recovered", "1")
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New Agent", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Something went wrong", { exact: true })
  ).toHaveCount(0);
  await expect(page.getByTestId("dashboard-shell")).toBeVisible();
});
