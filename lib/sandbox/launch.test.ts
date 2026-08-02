import { describe, expect, it, vi } from "vitest";
import { resolveNameCollision } from "@/lib/sandbox/launch";
import { buildSandboxName } from "@/lib/sandbox/sandbox-name";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
});

const input = {
  name: "mogplex-user12-repo12-main",
  repoId: "repo-1",
  userId: "user-1",
  workingBranch: "main",
  rootDirectory: null,
  baseBranch: "main",
  credentials: {
    vercelToken: "vercel-token",
    vercelProjectId: "project-1",
    vercelTeamId: null,
  },
};

describe("resolveNameCollision", () => {
  it("creates when Vercel has no sandbox for the deterministic name", async () => {
    const result = await resolveNameCollision(input, {
      getSandbox: async () => {
        throw Object.assign(new Error("Sandbox not found"), { status: 404 });
      },
    });

    expect(result).toEqual({ kind: "create" });
  });

  it("resumes a matching record when only the resume probe can see the sandbox", async () => {
    const record = sandboxRecord({ status: "running" });
    const getSandbox = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Sandbox not found"), { status: 404 })
      )
      .mockResolvedValueOnce({ name: input.name, status: "running" });

    const result = await resolveNameCollision(input, {
      getSandbox,
      loadMatchingRecord: async () => record,
      insertAdoptedRecord: async () => {
        throw new Error("insertAdoptedRecord should not be called");
      },
    });

    expect(getSandbox).toHaveBeenCalledWith(input.name, input.credentials, {
      resume: false,
    });
    expect(getSandbox).toHaveBeenCalledWith(input.name, input.credentials, {
      resume: true,
    });
    expect(result).toEqual({ kind: "resume", record });
  });

  it("resumes a matching running DB record without creating", async () => {
    const record = sandboxRecord({ status: "running" });
    const result = await resolveNameCollision(input, {
      getSandbox: async () =>
        ({ name: input.name, status: "running" }) as never,
      loadMatchingRecord: async () => record,
      insertAdoptedRecord: async () => {
        throw new Error("insertAdoptedRecord should not be called");
      },
    });

    expect(result).toEqual({ kind: "resume", record });
  });

  it("resumes a matching paused DB record without creating", async () => {
    const record = sandboxRecord({
      status: "paused",
      healthStatus: "paused",
      snapshotId: "snapshot-1",
    });
    const result = await resolveNameCollision(input, {
      getSandbox: async () =>
        ({ name: input.name, status: "running" }) as never,
      loadMatchingRecord: async () => record,
      insertAdoptedRecord: async () => {
        throw new Error("insertAdoptedRecord should not be called");
      },
    });

    expect(result).toEqual({ kind: "resume", record });
  });

  it("retires a paused record when Vercel reports a stopped non-persistent sandbox", async () => {
    const record = sandboxRecord({
      status: "paused",
      healthStatus: "paused",
      snapshotId: "snapshot-1",
    });
    const deleteSandbox = vi.fn(async () => undefined);
    const loadMatchingRecord = vi.fn(async () => record);
    const stopMatchingRecord = vi.fn(async () => undefined);

    const result = await resolveNameCollision(input, {
      getSandbox: async () =>
        ({
          name: input.name,
          status: "stopped",
          sandbox: { persistent: false },
        }) as never,
      loadMatchingRecord,
      insertAdoptedRecord: async () => {
        throw new Error("insertAdoptedRecord should not be called");
      },
      stopMatchingRecord,
      deleteSandbox,
    });

    expect(loadMatchingRecord).toHaveBeenCalledWith(
      expect.objectContaining({ name: input.name })
    );
    expect(stopMatchingRecord).toHaveBeenCalledWith(record);
    expect(deleteSandbox).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "create" });
  });

  it("adopts a usable orphaned Vercel sandbox", async () => {
    const adopted = sandboxRecord({ status: "running" });
    const insertAdoptedRecord = vi.fn(async () => adopted);
    const result = await resolveNameCollision(input, {
      getSandbox: async () =>
        ({
          name: input.name,
          status: "running",
          sandbox: { persistent: false },
        }) as never,
      loadMatchingRecord: async () => null,
      insertAdoptedRecord,
    });

    expect(insertAdoptedRecord).toHaveBeenCalledWith(
      expect.objectContaining({ persistent: false })
    );
    expect(result).toEqual({ kind: "adopt", record: adopted });
  });

  it("recreates a non-persistent orphan when the collision probe had to revive it", async () => {
    const getSandbox = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Sandbox not found"), { status: 404 })
      )
      .mockResolvedValueOnce({
        name: input.name,
        status: "running",
        sandbox: { persistent: false },
      });
    const deleteSandbox = vi.fn(async () => undefined);

    const result = await resolveNameCollision(input, {
      getSandbox,
      loadMatchingRecord: async () => null,
      insertAdoptedRecord: async () => {
        throw new Error("insertAdoptedRecord should not be called");
      },
      deleteSandbox,
    });

    expect(getSandbox).toHaveBeenNthCalledWith(
      1,
      input.name,
      input.credentials,
      {
        resume: false,
      }
    );
    expect(getSandbox).toHaveBeenNthCalledWith(
      2,
      input.name,
      input.credentials,
      {
        resume: true,
      }
    );
    expect(deleteSandbox).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "create" });
  });

  it("threads rootDirectory through matching and adoption", async () => {
    const scopedInput = {
      ...input,
      name: "mogplex-user12-repo12-main-apps-web",
      rootDirectory: "apps/web",
    };
    const adopted = sandboxRecord({
      status: "running",
      rootDirectory: "apps/web",
    });
    const loadMatchingRecord = vi.fn(async () => null);
    const insertAdoptedRecord = vi.fn(async () => adopted);

    const result = await resolveNameCollision(scopedInput, {
      getSandbox: async () =>
        ({ name: scopedInput.name, status: "running" }) as never,
      loadMatchingRecord,
      insertAdoptedRecord,
    });

    expect(loadMatchingRecord).toHaveBeenCalledWith(
      expect.objectContaining({ rootDirectory: "apps/web" })
    );
    expect(insertAdoptedRecord).toHaveBeenCalledWith(
      expect.objectContaining({ rootDirectory: "apps/web" })
    );
    expect(result).toEqual({ kind: "adopt", record: adopted });
  });

  it("threads product team and actor through matching and adoption", async () => {
    const teamInput = {
      ...input,
      name: "mogplex-user12-tteam12-repo12-main-root",
      productTeamId: "team-123",
      actorUserId: "user-1",
    };
    const adopted = sandboxRecord({ status: "running" });
    const loadMatchingRecord = vi.fn(async () => null);
    const insertAdoptedRecord = vi.fn(async () => adopted);

    const result = await resolveNameCollision(teamInput, {
      getSandbox: async () =>
        ({ name: teamInput.name, status: "running" }) as never,
      loadMatchingRecord,
      insertAdoptedRecord,
    });

    expect(loadMatchingRecord).toHaveBeenCalledWith(
      expect.objectContaining({ productTeamId: "team-123" })
    );
    expect(insertAdoptedRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        productTeamId: "team-123",
        actorUserId: "user-1",
      })
    );
    expect(result).toEqual({ kind: "adopt", record: adopted });
  });

  it("does not resume a matching DB record for a different rootDirectory", async () => {
    const wrongRootRecord = sandboxRecord({
      status: "running",
      rootDirectory: "apps/admin",
    });
    const deleteSandbox = vi.fn(async () => undefined);
    const scopedInput = {
      ...input,
      name: "mogplex-user12-repo12-main-apps-web",
      rootDirectory: "apps/web",
    };

    const result = await resolveNameCollision(scopedInput, {
      getSandbox: async () =>
        ({ name: scopedInput.name, status: "stopped" }) as never,
      loadMatchingRecord: async () => wrongRootRecord,
      insertAdoptedRecord: async () => {
        throw new Error("insertAdoptedRecord should not be called");
      },
      deleteSandbox,
    });

    expect(deleteSandbox).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "create" });
  });

  it("deletes a stopped Vercel sandbox and creates fresh", async () => {
    const deleteSandbox = vi.fn(async () => undefined);
    const result = await resolveNameCollision(input, {
      getSandbox: async () =>
        ({ name: input.name, status: "stopped" }) as never,
      loadMatchingRecord: async () => null,
      insertAdoptedRecord: async () => {
        throw new Error("insertAdoptedRecord should not be called");
      },
      deleteSandbox,
    });

    expect(deleteSandbox).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "create" });
  });
});

describe("buildSandboxName", () => {
  it("keeps same repo and branch launches distinct by rootDirectory", () => {
    const rootName = buildSandboxName({
      repoId: "repo-1",
      workingBranch: "main",
      userId: "user-1",
      rootDirectory: null,
    });
    const appName = buildSandboxName({
      repoId: "repo-1",
      workingBranch: "main",
      userId: "user-1",
      rootDirectory: "apps/web",
    });

    expect(rootName).toBe("mogplex-user1-repo1-main-root");
    expect(appName).toBe("mogplex-user1-repo1-main-apps-web");
    expect(rootName).not.toBe(appName);
  });
});
