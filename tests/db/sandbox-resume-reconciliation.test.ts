import { expect, it } from "vitest";
import {
  withResumeDatabase,
  legacyMissingVmWrite,
} from "../support/sandbox-resume-race-harness";
import { stopSandboxRecord } from "@/lib/sandbox/records";

it.each([false, true])(
  "an older resume cannot complete or roll back a newer boot (provider fails=%s)",
  async (fails) => {
    await withResumeDatabase(
      async ({ pg, resume }) => {
        const response = await resume();
        const body = await response.text();
        expect(response.status).toBe(fails ? 502 : 200);
        if (!fails) expect(body).toContain('"type":"cancelled"');
        expect(
          (
            await pg.query(
              "select status,preview_url,last_boot_started_at = '2099-01-01T00:00:00Z'::timestamptz as owns_new_boot from sandboxes"
            )
          ).rows
        ).toEqual([
          {
            status: "installing",
            preview_url: "https://new-boot.example.com",
            owns_new_boot: true,
          },
        ]);
      },
      "sandbox-1",
      async (pg) => {
        await pg.exec(
          "update sandboxes set last_boot_started_at='2099-01-01T00:00:00Z',preview_url='https://new-boot.example.com'"
        );
        if (fails) throw new Error("provider failed after supersession");
      }
    );
  }
);

it("the actual resume route survives an old deployment's liveness write and emits ready for the saved workspace", async () => {
  await withResumeDatabase(
    async ({ pg, resume }) => {
      const response = await resume();
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('"type":"ready"');
      expect(body).not.toContain('"type":"cancelled"');
      expect(
        (
          await pg.query(
            "select sandbox_id,working_branch,snapshot_id,status from sandboxes"
          )
        ).rows
      ).toEqual([
        {
          sandbox_id: "vm_123",
          working_branch: "saved-work",
          snapshot_id: "snap_saved",
          status: "running",
        },
      ]);
    },
    "sandbox-1",
    legacyMissingVmWrite
  );
});

it.each([null, "2026-10-10T00:00:00.000Z"])(
  "a stopped observation from boot %s cannot stop a resumed generation",
  async (previousBoot) => {
    await withResumeDatabase(async ({ pg, resume }) => {
      await (await resume()).text();
      expect(
        await stopSandboxRecord("sandbox-1", {
          expectedSandboxId: "vm_123",
          fromStatuses: "running",
          expectedLastBootStartedAt: previousBoot,
          stopReason: "vm_gone",
        })
      ).toBeNull();
      expect((await pg.query("select status from sandboxes")).rows).toEqual([
        { status: "running" },
      ]);
      const { rows } = await pg.query<{ last_boot_started_at: string }>(
        "select last_boot_started_at from sandboxes"
      );
      expect(
        await stopSandboxRecord("sandbox-1", {
          expectedSandboxId: "vm_123",
          fromStatuses: "running",
          expectedLastBootStartedAt: rows[0].last_boot_started_at,
          stopReason: "vm_gone",
        })
      ).toMatchObject({ status: "stopped" });
    });
  }
);
