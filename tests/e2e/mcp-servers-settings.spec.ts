import { expect, test, type Route } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";

type MockServer = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  envPlain: Record<string, string>;
  envSecretNames: string[];
  url: string | null;
  headerPlain: Record<string, string>;
  headerSecretNames: string[];
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const connectedUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  platform_access: {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  },
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

test("settings MCP page supports add, edit, secret overwrite, and delete without exposing refs", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);

  const postBodies: unknown[] = [];
  const patchBodies: unknown[] = [];
  let servers: MockServer[] = [];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) => fulfillJson(route, []));
  await page.route(
    /\/api\/mcp-servers(?:\/[^/?]+)?(?:\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const pathSegments = url.pathname.split("/").filter(Boolean);
      const maybeId = pathSegments.length === 3 ? pathSegments[2] : null;

      if (request.method() === "GET") {
        if (maybeId) {
          const server = servers.find((entry) => entry.id === maybeId);
          if (!server) {
            await fulfillJson(route, { error: "Server not found" }, 404);
            return;
          }
          await fulfillJson(route, { server });
          return;
        }

        await fulfillJson(route, { servers });
        return;
      }

      if (request.method() === "POST") {
        const body = JSON.parse(request.postData() || "{}") as Record<
          string,
          unknown
        >;
        postBodies.push(body);

        expect(body).not.toHaveProperty("env_refs");
        expect(body).not.toHaveProperty("header_refs");

        const now = new Date().toISOString();
        const server: MockServer = {
          id: "server-1",
          name: String(body.name),
          enabled: body.enabled !== false,
          transport: body.transport === "http" ? "http" : "stdio",
          command: typeof body.command === "string" ? body.command : null,
          args: Array.isArray(body.args) ? (body.args as string[]) : [],
          envPlain: (body.envPlain as Record<string, string>) ?? {},
          envSecretNames: Object.keys(
            (body.envSecrets as Record<string, string>) ?? {}
          ),
          url: typeof body.url === "string" ? body.url : null,
          headerPlain: (body.headerPlain as Record<string, string>) ?? {},
          headerSecretNames: Object.keys(
            (body.headerSecrets as Record<string, string>) ?? {}
          ),
          extra: (body.extra as Record<string, unknown>) ?? {},
          createdAt: now,
          updatedAt: now,
        };
        servers = [server];
        await fulfillJson(route, { server }, 201);
        return;
      }

      if (request.method() === "PATCH" && maybeId) {
        const body = JSON.parse(request.postData() || "{}") as Record<
          string,
          unknown
        >;
        patchBodies.push(body);

        expect(body).not.toHaveProperty("env_refs");
        expect(body).not.toHaveProperty("header_refs");

        const current = servers.find((entry) => entry.id === maybeId);
        expect(current).toBeTruthy();

        const envSecrets =
          (body.envSecrets as Record<string, string | null>) ?? {};
        const nextEnvSecretNames = new Set(current?.envSecretNames);
        for (const [key, value] of Object.entries(envSecrets)) {
          if (value === null) {
            nextEnvSecretNames.delete(key);
          } else {
            nextEnvSecretNames.add(key);
          }
        }

        const headerSecrets =
          (body.headerSecrets as Record<string, string | null>) ?? {};
        const nextHeaderSecretNames = new Set(current?.headerSecretNames);
        for (const [key, value] of Object.entries(headerSecrets)) {
          if (value === null) {
            nextHeaderSecretNames.delete(key);
          } else {
            nextHeaderSecretNames.add(key);
          }
        }

        const updated: MockServer = {
          id: maybeId,
          name: String(body.name),
          enabled: body.enabled !== false,
          transport: body.transport === "http" ? "http" : "stdio",
          command: typeof body.command === "string" ? body.command : null,
          args: Array.isArray(body.args) ? (body.args as string[]) : [],
          envPlain: (body.envPlain as Record<string, string>) ?? {},
          envSecretNames: [...nextEnvSecretNames],
          url: typeof body.url === "string" ? body.url : null,
          headerPlain: (body.headerPlain as Record<string, string>) ?? {},
          headerSecretNames: [...nextHeaderSecretNames],
          extra: (body.extra as Record<string, unknown>) ?? {},
          createdAt: current?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        servers = [updated];
        await fulfillJson(route, { server: updated });
        return;
      }

      if (request.method() === "DELETE" && maybeId) {
        servers = servers.filter((entry) => entry.id !== maybeId);
        await fulfillJson(route, { ok: true });
        return;
      }

      await fulfillJson(route, { error: "Unsupported route in test" }, 500);
    }
  );

  await page.goto(scopedPath("settings/mcp"));

  await page.getByRole("button", { name: "Add server" }).click();
  await page.getByLabel("Name").fill("supabase");
  await page.getByLabel("Command").fill("npx");
  await page
    .getByLabel("Args")
    .fill("-y\n@supabase/mcp-server-supabase@latest");
  await page.getByRole("button", { name: "Add secret environment" }).click();
  await page.getByPlaceholder("Environment name").fill("SUPABASE_ACCESS_TOKEN");
  await page.getByPlaceholder("Secret value").fill("sbp_initial_123");
  await page.getByRole("button", { name: "Create server" }).click();

  await expect(page.getByText("supabase")).toBeVisible();
  expect(postBodies).toHaveLength(1);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(
    page.getByRole("dialog").getByText("Saved", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByPlaceholder("Overwrite saved secret").fill("sbp_updated_456");
  await page.getByRole("button", { name: "Save changes" }).click();

  expect(patchBodies).toHaveLength(2);
  expect(patchBodies[0]).toMatchObject({
    envSecrets: {},
  });
  expect(patchBodies[1]).toMatchObject({
    envSecrets: {
      SUPABASE_ACCESS_TOKEN: "sbp_updated_456",
    },
  });

  await page.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByText("No synced MCP servers yet.")).toBeVisible();
});
