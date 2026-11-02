import { describe, expect, it, vi } from "vitest";
import {
  installRepo,
  tools,
} from "../../../tests/support/project-settings-fixture";

describe("project settings tools", () => {
  it("should report variable names without their values", async () => {
    installRepo();

    const settings = await tools().project_settings.execute({});

    expect(settings).toMatchObject({
      runtime: "node22",
      // Detection is on, so the stored port is not the one boots use.
      devPort: null,
      devPortAuto: true,
      envVarNames: ["DATABASE_URL"],
    });
    expect(JSON.stringify(settings)).not.toContain("postgres://");
  });

  it("should save working commands for future boots", async () => {
    const { writes } = installRepo();

    const result = await tools().project_settings_update.execute({
      installCommand: "pip install -e .",
      devCommand: "uvicorn app.main:app --host 0.0.0.0 --port 8000",
      devPort: 8000,
      rootDirectory: "api",
    });

    expect(result).toMatchObject({
      ok: true,
      settings: { devPort: 8000, rootDirectory: "api" },
    });
    expect(result).toMatchObject({ settings: { devPortAuto: false } });
    expect(writes).toEqual([
      expect.objectContaining({
        dev_port_auto: false,
        install_command: "pip install -e .",
        dev_command: "uvicorn app.main:app --host 0.0.0.0 --port 8000",
        dev_port: 8000,
        root_directory: "api",
      }),
    ]);
  });

  it("should refuse a team project to a member without project write access", async () => {
    const { writes } = installRepo({
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    });

    const result = await tools(
      "team-1",
      "viewer"
    ).project_settings_update.execute({ devPort: 8000 });

    expect(result).toEqual({
      error: "You do not have permission to change this project.",
    });
    expect(writes).toEqual([]);
  });

  it("should save a team project for a member with project write access", async () => {
    installRepo({
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    });

    expect(
      await tools("team-1").project_settings_update.execute({ devPort: 8000 })
    ).toMatchObject({ ok: true });
  });

  it("should not reach another user's personal project", async () => {
    installRepo({ owner_user_id: "someone-else" });

    expect(await tools().project_settings.execute({})).toEqual({
      error:
        "Project not found in your personal projects. If it belongs to a team, select that team and try again.",
    });
  });

  it("should let a team viewer read settings it cannot change", async () => {
    installRepo({
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    });

    expect(
      await tools("team-1", "viewer").project_settings.execute({})
    ).toMatchObject({ envVarNames: ["DATABASE_URL"] });
  });

  it("should not call a failed team lookup a permission problem", async () => {
    installRepo();

    expect(
      await tools("team-1", "lookup-failed").project_settings.execute({})
    ).toEqual({ error: "Could not check your team access. Try again." });
  });

  it("should reject a dev port outside the valid range", () => {
    const schema = tools().project_settings_update.inputSchema;

    expect(schema.safeParse({ devPort: 0 }).success).toBe(false);
    expect(schema.safeParse({ devPort: 70_000 }).success).toBe(false);
    expect(schema.safeParse({ devPort: 5173 }).success).toBe(true);
  });

  it("should turn port detection back on when the port is cleared", async () => {
    const { writes } = installRepo({ dev_port: 8000, dev_port_auto: false });

    const result = await tools().project_settings_update.execute({
      devPort: null,
      replace: true,
    });

    expect(result).toMatchObject({
      ok: true,
      settings: { devPortAuto: true },
      replaced: { devPort: 8000 },
    });
    expect(writes).toEqual([{ dev_port_auto: true }]);
  });

  it("should report a missing project when a settings save matches no row", async () => {
    installRepo({ owner_user_id: "someone-else" });

    expect(
      await tools().project_settings_update.execute({ devCommand: "make dev" })
    ).toEqual({
      error:
        "Project not found in your personal projects. If it belongs to a team, select that team and try again.",
    });
  });

  it("should describe the port and variable scope the way boots resolve them", async () => {
    installRepo({
      dev_port: null,
      dev_port_auto: false,
      env_sync_mode: "vercel-project",
    });

    expect(await tools().project_settings.execute({})).toMatchObject({
      devPort: 3000,
      devPortAuto: false,
      envVarScope: "sandbox-only",
    });
  });

  it("should not ask to replace a pinned port that has no stored number", async () => {
    const { writes } = installRepo({ dev_port: null, dev_port_auto: false });

    expect(
      await tools().project_settings_update.execute({ devPort: 5173 })
    ).toMatchObject({ ok: true, settings: { devPort: 5173 } });
    expect(writes).toEqual([{ dev_port: 5173, dev_port_auto: false }]);
  });

  it("should redact a credential inside a saved command it reads back", async () => {
    installRepo({
      install_command:
        "npm config set //registry.npmjs.org/:_authToken=opaque-npm-value && npm ci",
    });

    const settings = await tools().project_settings.execute({});
    const refused = await tools().project_settings_update.execute({
      installCommand: "pnpm install",
    });

    expect(settings).toMatchObject({
      installCommand:
        "npm config set //registry.npmjs.org/:_authToken=[redacted] && npm ci",
    });
    expect(refused).toMatchObject({
      saved: {
        installCommand:
          "npm config set //registry.npmjs.org/:_authToken=[redacted] && npm ci",
      },
    });
    expect(JSON.stringify([settings, refused])).not.toContain("opaque-npm");
  });

  it("should refuse to save a command carrying the redaction marker", () => {
    const schema = tools().project_settings_update.inputSchema;

    expect(
      schema.safeParse({ installCommand: "npm ci && API_TOKEN=[redacted]" })
        .success
    ).toBe(false);
    expect(
      schema.safeParse({ devCommand: "API_TOKEN=[redacted] npm run dev" })
        .success
    ).toBe(false);
    expect(schema.safeParse({ installCommand: "npm ci" }).success).toBe(true);
  });

  it("should report no variable names when the stored map is not an object", async () => {
    installRepo({ sandbox_env_vars: "corrupt" });

    expect(await tools().project_settings.execute({})).toMatchObject({
      envVarNames: [],
    });
  });

  it("should report a pinned dev port as the one boots use", async () => {
    installRepo({ dev_port: 8000, dev_port_auto: false });

    expect(await tools().project_settings.execute({})).toMatchObject({
      devPort: 8000,
      devPortAuto: false,
    });
  });

  it("should let setup correct a saved runtime or directory without replace", async () => {
    const { writes } = installRepo({ root_directory: "web" });

    expect(
      await tools().project_settings_update.execute({ rootDirectory: "api" })
    ).toMatchObject({ ok: true, replaced: { rootDirectory: "web" } });
    expect(writes).toEqual([{ root_directory: "api" }]);
  });

  it("should redact a secret quoted in a failed load's message", async () => {
    installRepo({}, () => null, {
      message: 'syntax error near "api_token=opaque-load-value"',
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await tools().project_settings.execute({})).toEqual({
      error: "Could not load project settings.",
    });
    expect(JSON.stringify(log.mock.calls)).toContain("syntax error near");
    expect(JSON.stringify(log.mock.calls)).not.toContain("opaque-load-value");
    log.mockRestore();
  });

  it("should log only the error code when a settings save fails", async () => {
    installRepo({}, () => ({
      code: "23514",
      message: "failing row contains (make dev)",
    }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await tools().project_settings_update.execute({ devCommand: "make dev" })
    ).toEqual({ error: "Could not save project settings." });
    expect(log).toHaveBeenCalledWith(expect.any(String), "23514");
    expect(JSON.stringify(log.mock.calls)).not.toContain("failing row");
    log.mockRestore();
  });

  it("should save a runtime for future boots", async () => {
    const { writes } = installRepo();

    expect(
      await tools().project_settings_update.execute({ runtime: "python3.13" })
    ).toMatchObject({
      ok: true,
      settings: { runtime: "python3.13" },
      replaced: { runtime: "node22" },
    });
    expect(writes).toEqual([{ runtime: "python3.13" }]);
    expect(
      tools().project_settings_update.inputSchema.safeParse({ runtime: "ruby" })
        .success
    ).toBe(false);
  });

  it("should not replace a saved command without the operator's say-so", async () => {
    const { writes } = installRepo({ dev_command: "make serve" });

    expect(
      await tools().project_settings_update.execute({
        devCommand: "npm run dev",
      })
    ).toEqual({
      error:
        "devCommand already saved. Tell the operator what you would change and why; call again with replace: true only once they agree.",
      saved: { devCommand: "make serve" },
    });
    expect(writes).toEqual([]);
  });

  it("should treat saving the same value again as no replacement", async () => {
    installRepo({ dev_command: "make serve" });

    const result = await tools().project_settings_update.execute({
      devCommand: "make serve",
    });

    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty("replaced");
  });

  it("should reject a root directory outside the repository", () => {
    const schema = tools().project_settings_update.inputSchema;

    expect(schema.safeParse({ rootDirectory: "../other" }).success).toBe(false);
    expect(schema.safeParse({ rootDirectory: "apps/web/.." }).success).toBe(
      false
    );
    expect(schema.safeParse({ rootDirectory: "%2e%2e/other" }).success).toBe(
      false
    );
    // The settings drawer keeps internal spaces, so Control does too.
    expect(schema.safeParse({ rootDirectory: "my app" }).success).toBe(true);
    expect(schema.safeParse({ rootDirectory: "apps/web" }).success).toBe(true);
    expect(schema.safeParse({ rootDirectory: null }).success).toBe(true);
    expect(schema.safeParse({ rootDirectory: " apps/web\n" }).data).toEqual({
      rootDirectory: "apps/web",
    });
  });

  it("should say which team was searched when a team project is missing", async () => {
    installRepo();

    expect(await tools("team-1").project_settings.execute({})).toEqual({
      error:
        "Project not found in the selected team. If it is a personal project or belongs to another team, switch to that scope and try again.",
    });
  });

  it("should not overwrite a setting the operator saved after the read", async () => {
    const { row, writes } = installRepo({}, (current) => {
      current.dev_command = "make serve";
    });

    expect(
      await tools().project_settings_update.execute({
        devCommand: "npm run dev",
      })
    ).toEqual({ error: "Project settings changed while saving. Try again." });
    expect(writes).toEqual([]);
    expect(row.dev_command).toBe("make serve");
  });

  it("should treat an empty saved command as unset", async () => {
    installRepo({ install_command: "" });

    expect(
      await tools().project_settings_update.execute({
        installCommand: "pip install -e .",
      })
    ).toMatchObject({
      ok: true,
      settings: { installCommand: "pip install -e ." },
    });
  });
});
