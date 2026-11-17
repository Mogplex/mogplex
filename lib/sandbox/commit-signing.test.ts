import assert from "node:assert/strict";
import { test } from "vitest";
import {
  COMMIT_SIGNING_ENCRYPTION_ENV,
  CommitSigningEncryptionError,
} from "../commit-signing/secret-box";
import {
  COMMIT_SIGNING_UNSUPPORTED_EXIT_CODE,
  buildCommitSigningScrubScript,
  buildCommitSigningSetupScript,
  configureSandboxCommitSigning,
  scrubSandboxCommitSigning,
  setupSandboxCommitSigning,
} from "./commit-signing";

type FakeCommand = { cmd: string; args?: string[] };

function fakeSandbox(exitCode = 0) {
  const written: { path: string; content: string; mode?: number }[] = [];
  const commands: FakeCommand[] = [];
  return {
    written,
    commands,
    sandbox: {
      writeFiles: async (
        files: { path: string; content: string | Uint8Array; mode?: number }[]
      ) => {
        for (const file of files) {
          written.push({
            path: file.path,
            content: String(file.content),
            mode: file.mode,
          });
        }
      },
      runCommand: async (command: FakeCommand) => {
        commands.push(command);
        return { exitCode };
      },
    },
  };
}

test("the setup script turns on SSH commit signing", () => {
  const script = buildCommitSigningSetupScript();
  assert.match(script, /git config --global gpg\.format ssh/);
  assert.match(script, /git config --global user\.signingkey "\$key_path"/);
  assert.match(script, /git config --global commit\.gpgsign true/);
  assert.match(script, /git config --global tag\.gpgsign true/);
  assert.match(script, /install -m 600 "\$staged_key" "\$key_path"/);
  assert.match(script, /ssh-keygen -y -f "\$key_path"/);
  // A sandbox without SSH signing support must not be half-configured.
  assert.match(script, /git --version/);
  assert.match(script, /command -v ssh-keygen/);
});

test("the scrub script removes the key and the gitconfig entries", () => {
  const script = buildCommitSigningScrubScript();
  assert.match(script, /rm -f "\$key_path"/);
  assert.match(script, /git config --global --unset user\.signingkey/);
  assert.match(script, /git config --global --unset commit\.gpgsign/);
  assert.match(script, /git config --global --unset gpg\.format/);
});

test("installing a key writes it with owner-only permissions", async () => {
  const fake = fakeSandbox(0);
  const result = await configureSandboxCommitSigning({
    sandbox: fake.sandbox,
    privateKey:
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n",
  });

  assert.equal(result.status, "configured");
  assert.equal(fake.written.length, 1);
  assert.equal(fake.written[0]?.mode, 0o600);
  assert.ok(fake.written[0]?.content.includes("BEGIN OPENSSH PRIVATE KEY"));
  assert.equal(fake.commands.length, 1);
  assert.equal(fake.commands[0]?.cmd, "sh");
});

test("a sandbox that cannot sign is left unsigned instead of failing", async () => {
  const fake = fakeSandbox(COMMIT_SIGNING_UNSUPPORTED_EXIT_CODE);
  const result = await configureSandboxCommitSigning({
    sandbox: fake.sandbox,
    privateKey: "key",
  });

  assert.equal(result.status, "unsupported");
  assert.ok(result.reason);
});

test("a failing setup command does not throw", async () => {
  const fake = fakeSandbox(1);
  const result = await configureSandboxCommitSigning({
    sandbox: fake.sandbox,
    privateKey: "key",
  });

  assert.equal(result.status, "failed");
});

test("setup failures retain classified diagnostics without provider secrets", async () => {
  const entries: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args) => entries.push(args);
  try {
    const result = await configureSandboxCommitSigning({
      privateKey: "private-signing-material",
      sandbox: {
        writeFiles: async () => {
          throw Object.assign(
            new Error("private-signing-material authorization=secret-token"),
            { status: 403 }
          );
        },
        runCommand: async () => ({ exitCode: 0 }),
      },
    });
    assert.equal(result.status, "failed");
    const recorded = JSON.stringify(entries);
    assert.match(recorded, /key_install/);
    assert.match(recorded, /authorization/);
    assert.match(recorded, /403/);
    assert.doesNotMatch(
      recorded + JSON.stringify(result),
      /private-signing-material|secret-token/
    );
  } finally {
    console.warn = warn;
  }
});

test("snapshot cleanup errors retain only a safe diagnostic cause", async () => {
  await assert.rejects(
    scrubSandboxCommitSigning({
      sandbox: {
        writeFiles: async () => {},
        runCommand: async () => {
          throw Object.assign(new Error("private-command-detail"), {
            code: "ETIMEDOUT",
          });
        },
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.deepEqual(error.cause, { category: "timeout", code: "ETIMEDOUT" });
      assert.doesNotMatch(
        JSON.stringify(error) + error.message,
        /private-command-detail/
      );
      return true;
    }
  );
});

test("without a key the sandbox is left exactly as it is", async () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "test-secret-value";
  const fake = fakeSandbox(0);
  try {
    const result = await setupSandboxCommitSigning({
      sandbox: fake.sandbox,
      userId: "user-1",
      loadPrivateKey: async () => null,
    });

    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "no signing key");
    assert.equal(fake.written.length, 0);
    assert.equal(fake.commands.length, 0);
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});

test("without a deployment secret nothing is written to the sandbox", async () => {
  delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  const fake = fakeSandbox(0);
  const result = await setupSandboxCommitSigning({
    sandbox: fake.sandbox,
    userId: "user-1",
    loadPrivateKey: async () => "key",
  });

  assert.equal(result.status, "skipped");
  assert.equal(fake.written.length, 0);
  assert.equal(fake.commands.length, 0);
});

test("a stored key is installed into the sandbox", async () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "test-secret-value";
  const fake = fakeSandbox(0);
  try {
    const result = await setupSandboxCommitSigning({
      sandbox: fake.sandbox,
      userId: "user-1",
      loadPrivateKey: async () => "private-key-material",
    });

    assert.equal(result.status, "configured");
    assert.equal(fake.written.length, 1);
    assert.equal(fake.commands.length, 1);
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});

test("a key that cannot be read is reported instead of thrown", async () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "test-secret-value";
  const fake = fakeSandbox(0);
  try {
    const result = await setupSandboxCommitSigning({
      sandbox: fake.sandbox,
      userId: "user-1",
      loadPrivateKey: async () => {
        throw new Error("decrypt failed");
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(fake.commands.length, 0);
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});

test("scrubbing removes the key from a sandbox before it is captured", async () => {
  const fake = fakeSandbox(0);
  await scrubSandboxCommitSigning({ sandbox: fake.sandbox });

  assert.equal(fake.commands.length, 1);
  assert.match(fake.commands[0]?.args?.[1] ?? "", /rm -f "\$key_path"/);
});

test("a failed key scrub blocks snapshot capture", async () => {
  await assert.rejects(
    scrubSandboxCommitSigning({ sandbox: fakeSandbox(1).sandbox }),
    /signing key/i
  );
  const fake = fakeSandbox();
  fake.sandbox.runCommand = async () => {
    throw new Error("provider unavailable");
  };
  await assert.rejects(
    scrubSandboxCommitSigning({ sandbox: fake.sandbox }),
    /signing key/i
  );
});

test("encryption failures provide distinct recovery guidance without leaking their message", async () => {
  process.env[COMMIT_SIGNING_ENCRYPTION_ENV] = "test-secret-value";
  try {
    const result = await setupSandboxCommitSigning({
      sandbox: fakeSandbox().sandbox,
      userId: "user-1",
      loadPrivateKey: async () => {
        throw new CommitSigningEncryptionError("private-key-material");
      },
    });
    assert.equal(result.status, "failed");
    assert.match(
      result.reason ?? "",
      /could not be decrypted; contact your administrator/
    );
    assert.doesNotMatch(JSON.stringify(result), /private-key-material/);
  } finally {
    delete process.env[COMMIT_SIGNING_ENCRYPTION_ENV];
  }
});
