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

  it("should answer a missing permission before judging the name", async () => {
    const { writes } = installRepo({
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    });

    expect(
      await tools("team-1", "viewer").project_env_set.execute({
        name: "1BAD",
        value: "x",
      })
    ).toEqual({ error: "You do not have permission to change this project." });
    expect(writes).toEqual([]);
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

  it("should keep a variable the operator saved after the read and retry on top of it", async () => {
    let conflicts = 0;
    const { row } = installRepo({}, (current) => {
      if (conflicts > 0) return;
      conflicts += 1;
      current.sandbox_env_vars = {
        ...(current.sandbox_env_vars as object),
        OPERATOR_KEY: "saved-meanwhile",
      };
    });

    expect(
      await tools().project_env_set.execute({ name: "PORT", value: "8000" })
    ).toMatchObject({ ok: true, name: "PORT" });
    expect(row.sandbox_env_vars).toEqual({
      DATABASE_URL: "postgres://owner@db/app",
      OPERATOR_KEY: "saved-meanwhile",
      PORT: "8000",
    });
  });

  it("should give up without writing when every attempt loses the race", async () => {
    let saves = 0;
    const { row, writes } = installRepo({}, (current) => {
      saves += 1;
      current.sandbox_env_vars = { OPERATOR_KEY: `save-${saves}` };
    });

    expect(
      await tools().project_env_set.execute({ name: "PORT", value: "8000" })
    ).toEqual({ error: "Project variables changed while saving. Try again." });
    expect(writes).toEqual([]);
    expect(row.sandbox_env_vars).toEqual({ OPERATOR_KEY: `save-${saves}` });
  });

  it("should check replace again when the operator set the same name meanwhile", async () => {
    const { row, writes } = installRepo({}, (current) => {
      current.sandbox_env_vars = { PORT: "3000" };
    });

    expect(
      await tools().project_env_set.execute({ name: "PORT", value: "8000" })
    ).toHaveProperty("error", expect.stringContaining("replace: true"));
    expect(writes).toEqual([]);
    expect(row.sandbox_env_vars).toEqual({ PORT: "3000" });
  });

  it("should leave deleting a secret-named variable to the operator", async () => {
    const { writes } = installRepo({
      sandbox_env_vars: { GITHUB_TOKEN: "stored", PORT: "3000" },
    });

    expect(
      await tools().project_env_set.execute({
        name: "GITHUB_TOKEN",
        value: null,
        replace: true,
      })
    ).toEqual({
      error:
        "GITHUB_TOKEN may hold a secret. Ask the operator to remove it in Project settings.",
    });
    expect(writes).toEqual([]);
    expect(
      await tools().project_env_set.execute({
        name: "PORT",
        value: null,
        replace: true,
      })
    ).toMatchObject({ ok: true, deleted: true });
  });

  it("should refuse values that look like secrets and keep ordinary ones", async () => {
    const { writes } = installRepo();

    for (const [name, value] of [
      ["GITHUB_TOKEN", "anything"],
      ["STRIPE_SECRET", "opaque-value"],
      ["OPENAI_API_KEY", "opaque-value"],
      ["db_password", "opaque-value"],
      ["SECRET_KEY_BASE", "opaque-value"],
      ["UPSTREAM", "ghs_installationToken123"],
      ["CALLBACK", "https://api.example.test/hook?token=opaque-value"],
    ]) {
      expect(
        await tools().project_env_set.execute({ name, value })
      ).toHaveProperty(
        "error",
        expect.stringContaining("looks like a secret. Call project_env_request")
      );
    }
    expect(writes).toEqual([]);

    for (const [name, value] of [
      ["DATABASE_HOST", "postgres://owner@db/app"],
      ["SESSION_TTL", "3600"],
      ["MAX_TOKENS", "4096"],
      ["TOKEN_REFRESH_INTERVAL", "60"],
      ["KEYBOARD_LAYOUT", "us"],
    ]) {
      expect(
        await tools().project_env_set.execute({ name, value })
      ).toMatchObject({ ok: true, name });
    }
  });

  it("should reject a value that is empty once its quotes are stripped", async () => {
    const { writes } = installRepo();

    for (const value of ["''", '""', ' "" ', "   ", '"  "']) {
      expect(
        await tools().project_env_set.execute({ name: "PORT", value })
      ).toHaveProperty("error", expect.stringContaining("value: null"));
    }
    expect(writes).toEqual([]);
  });

  it("should reject an empty value instead of saving an empty variable", () => {
    const schema = tools().project_env_set.inputSchema;

    expect(schema.safeParse({ name: "PORT", value: "" }).success).toBe(false);
    expect(schema.safeParse({ name: "PORT", value: null }).success).toBe(true);
    expect(
      schema.safeParse({ name: "API_URL", value: "[redacted]" }).success
    ).toBe(false);
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
      "PIP_INDEX_URL",
      "pip_extra_index_url",
      "HOME",
      "IFS",
      "SSL_CERT_FILE",
      "ssl_cert_dir",
      "CURL_CA_BUNDLE",
      "REQUESTS_CA_BUNDLE",
      "GIT_PAGER",
      "git_ssh",
      "LESSOPEN",
      "PYTHONHOME",
      "PERL5LIB",
      "maven_opts",
      "ZDOTDIR",
      "CLASSPATH",
      "bundle_gemfile",
      "SSH_AUTH_SOCK",
      "GIT_SEQUENCE_EDITOR",
      "sudo_askpass",
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
    ).toMatchObject({
      ok: true,
      unchanged: true,
      note: "The variable was not set.",
    });
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
