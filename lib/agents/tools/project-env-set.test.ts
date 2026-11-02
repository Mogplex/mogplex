import { describe, expect, it } from "vitest";
import {
  installRepo,
  tools,
} from "../../../tests/support/project-settings-fixture";

describe("project_env_set", () => {
  it("should add a variable without dropping the ones already saved", async () => {
    const { row } = installRepo();

    const result = await tools().project_env_set.execute({
      name: "NODE_ENV",
      value: "development",
    });

    expect(result).toMatchObject({ ok: true, name: "NODE_ENV" });
    expect(row.sandbox_env_vars).toEqual({
      DATABASE_URL: "postgres://owner@db/app",
      NODE_ENV: "development",
    });
  });

  it("should reject names a shell or the stored object cannot hold", async () => {
    const { writes } = installRepo();

    for (const name of ["1PORT", "MY-VAR", "__proto__", " "]) {
      expect(
        await tools().project_env_set.execute({ name, value: "x" })
      ).toHaveProperty("error");
    }
    expect(writes).toEqual([]);
  });

  it("should save the first variable on a project that has none", async () => {
    const { row } = installRepo({ sandbox_env_vars: null });

    expect(
      await tools().project_env_set.execute({ name: "PORT", value: "8000" })
    ).toMatchObject({ ok: true });
    expect(row.sandbox_env_vars).toEqual({ PORT: "8000" });
  });

  it("should not overwrite variables the operator saved after the read", async () => {
    const { row } = installRepo({}, (current) => {
      current.sandbox_env_vars = { OPERATOR_KEY: "saved-meanwhile" };
    });

    expect(
      await tools().project_env_set.execute({ name: "PORT", value: "8000" })
    ).toEqual({ error: "Project variables changed while saving. Try again." });
    expect(row.sandbox_env_vars).toEqual({ OPERATOR_KEY: "saved-meanwhile" });
  });

  it("should refuse names that change how every sandbox program starts", async () => {
    const { writes } = installRepo();

    for (const name of [
      "NODE_OPTIONS",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "JAVA_TOOL_OPTIONS",
      "npm_config_registry",
      "http_proxy",
      "GIT_CONFIG_COUNT",
      "NODE_TLS_REJECT_UNAUTHORIZED",
      "path",
      "BASH_ENV",
    ]) {
      expect(
        await tools().project_env_set.execute({ name, value: "x" })
      ).toEqual({
        error: `${name} changes how every program in the sandbox starts. Ask the operator to set it in Project settings.`,
      });
    }
    expect(writes).toEqual([]);
  });

  it("should delete a variable it is given null for", async () => {
    const { row } = installRepo({
      sandbox_env_vars: {
        DATABASE_URL: "postgres://owner@db/app",
        PORT: "8000",
      },
    });

    expect(
      await tools().project_env_set.execute({
        name: "PORT",
        value: null,
        replace: true,
      })
    ).toMatchObject({ ok: true, name: "PORT", deleted: true });
    expect(row.sandbox_env_vars).toEqual({
      DATABASE_URL: "postgres://owner@db/app",
    });
  });

  it("should not write when deleting a variable that is not set", async () => {
    const { writes } = installRepo();

    expect(
      await tools().project_env_set.execute({ name: "PORT", value: null })
    ).toMatchObject({ ok: true, note: "The variable was not set." });
    expect(writes).toEqual([]);
  });

  it("should not replace a stored value unless asked to", async () => {
    const { row, writes } = installRepo();

    expect(
      await tools().project_env_set.execute({
        name: "DATABASE_URL",
        value: "placeholder",
      })
    ).toEqual({
      error:
        "DATABASE_URL is already set and its value may be a secret. Ask the operator before changing it, then call again with replace: true.",
    });
    expect(writes).toEqual([]);
    expect(row.sandbox_env_vars).toEqual({
      DATABASE_URL: "postgres://owner@db/app",
    });
  });

  it("should say so when it replaces a stored value", async () => {
    const { row } = installRepo({ sandbox_env_vars: { PORT: "3000" } });

    expect(
      await tools().project_env_set.execute({
        name: "PORT",
        value: "8000",
        replace: true,
      })
    ).toMatchObject({ ok: true, replaced: true });
    expect(row.sandbox_env_vars).toEqual({ PORT: "8000" });
  });

  it("should not delete a stored value unless asked to", async () => {
    const { row, writes } = installRepo();

    expect(
      await tools().project_env_set.execute({
        name: "DATABASE_URL",
        value: null,
      })
    ).toEqual({
      error:
        "DATABASE_URL is already set and its value may be a secret. Ask the operator before deleting it, then call again with replace: true.",
    });
    expect(writes).toEqual([]);
    expect(row.sandbox_env_vars).toEqual({
      DATABASE_URL: "postgres://owner@db/app",
    });
  });

  it("should store a quoted value the way the operator's editor does", async () => {
    const { row } = installRepo({ sandbox_env_vars: null });

    await tools().project_env_set.execute({
      name: "NODE_ENV",
      value: '"production"',
    });

    expect(row.sandbox_env_vars).toEqual({ NODE_ENV: "production" });
  });

  it("should leave other stored values exactly as they were", async () => {
    const { row } = installRepo({
      sandbox_env_vars: { QUOTED: '"kept-with-quotes"' },
    });

    await tools().project_env_set.execute({ name: "PORT", value: "8000" });

    expect(row.sandbox_env_vars).toEqual({
      QUOTED: '"kept-with-quotes"',
      PORT: "8000",
    });
  });
});
