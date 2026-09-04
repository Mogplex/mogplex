import { describe, expect, it, vi } from "vitest";
import { resolveNameCollision } from "@/lib/sandbox/launch";
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
  describe("stale named sandbox (listed by Vercel but not retrievable)", () => {
    const notFound = () =>
      Object.assign(new Error("Named sandbox 'x' has no latest sandbox."), {
        status: 404,
      });
    const staleListing = {
      name: input.name,
      status: "stopped",
      persistent: false,
    };

    it("deletes the stale name and reuses it when a stopped persistent record matches", async () => {
      const record = sandboxRecord({ status: "stopped", persistent: true });
      const deleteSandboxByName = vi.fn(async () => undefined);
      const stopMatchingRecord = vi.fn(async () => undefined);

      const result = await resolveNameCollision(input, {
        getSandbox: async () => {
          throw notFound();
        },
        loadMatchingRecord: async () => record,
        findNamedSandbox: async () => staleListing as never,
        deleteSandboxByName,
        stopMatchingRecord,
        insertAdoptedRecord: async () => {
          throw new Error("insertAdoptedRecord should not be called");
        },
      });

      expect(deleteSandboxByName).toHaveBeenCalledWith(
        input.name,
        input.credentials
      );
      expect(stopMatchingRecord).toHaveBeenCalledWith(record);
      expect(result).toEqual({ kind: "create" });
    });

    it("deletes the stale name and reuses it when no DB record matches", async () => {
      const deleteSandboxByName = vi.fn(async () => undefined);
      const stopMatchingRecord = vi.fn(async () => undefined);

      const result = await resolveNameCollision(input, {
        getSandbox: async () => {
          throw notFound();
        },
        loadMatchingRecord: async () => null,
        findNamedSandbox: async () => staleListing as never,
        deleteSandboxByName,
        stopMatchingRecord,
      });

      expect(deleteSandboxByName).toHaveBeenCalledTimes(1);
      expect(stopMatchingRecord).not.toHaveBeenCalled();
      expect(result).toEqual({ kind: "create" });
    });

    it("rolls forward under a replacement name when the stale name cannot be deleted", async () => {
      const record = sandboxRecord({ status: "stopped", persistent: true });

      const result = await resolveNameCollision(input, {
        getSandbox: async () => {
          throw notFound();
        },
        loadMatchingRecord: async () => record,
        findNamedSandbox: async () => staleListing as never,
        stopMatchingRecord: async () => undefined,
        deleteSandboxByName: async () => {
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
      });

      expect(result).toEqual({ kind: "replace", record });
    });

    it.each(["stopping", "snapshotting", "running"])(
      "rolls forward without deleting when the listed sandbox is %s",
      async (status) => {
        const record = sandboxRecord({ status: "stopped", persistent: true });
        const deleteSandboxByName = vi.fn(async () => undefined);

        const result = await resolveNameCollision(input, {
          getSandbox: async () => {
            throw notFound();
          },
          loadMatchingRecord: async () => record,
          findNamedSandbox: async () => ({ ...staleListing, status }) as never,
          deleteSandboxByName,
        });

        expect(deleteSandboxByName).not.toHaveBeenCalled();
        expect(result).toEqual({ kind: "replace", record });
      }
    );

    it("does not hand a stale name to a record for a different rootDirectory", async () => {
      const record = sandboxRecord({
        status: "stopped",
        persistent: true,
        rootDirectory: "apps/web",
      });
      const deleteSandboxByName = vi.fn(async () => undefined);

      const result = await resolveNameCollision(input, {
        getSandbox: async () => {
          throw notFound();
        },
        loadMatchingRecord: async () => record,
        findNamedSandbox: async () => staleListing as never,
        deleteSandboxByName,
      });

      expect(deleteSandboxByName).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ kind: "create" });
    });
  });

  it.each(["stopping", "snapshotting"])(
    "rolls a terminal persistent sandbox forward while the provider is %s",
    async (status) => {
      const record = sandboxRecord({ status: "stopped", persistent: true });
      const deleteSandbox = vi.fn(async () => undefined);

      const result = await resolveNameCollision(input, {
        getSandbox: async () =>
          ({
            name: input.name,
            status,
            sandbox: { persistent: true },
          }) as never,
        loadMatchingRecord: async () => record,
        insertAdoptedRecord: async () => {
          throw new Error("insertAdoptedRecord should not be called");
        },
        deleteSandbox,
      });

      expect(deleteSandbox).not.toHaveBeenCalled();
      expect(result).toEqual({ kind: "replace", record });
    }
  );

  it.each(["stopping", "snapshotting"])(
    "rolls forward from a terminal record while its old provider sandbox is %s",
    async (status) => {
      const record = sandboxRecord({
        status: "stopped",
        persistent: true,
        stopReason: "manual",
      });

      const result = await resolveNameCollision(input, {
        getSandbox: async () =>
          ({
            name: input.name,
            status,
            sandbox: { persistent: true },
          }) as never,
        loadMatchingRecord: async () => record,
        insertAdoptedRecord: async () => {
          throw new Error("insertAdoptedRecord should not be called");
        },
      });

      expect(result).toEqual({ kind: "replace", record });
    }
  );
});
