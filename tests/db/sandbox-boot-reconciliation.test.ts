import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("an old deployment cannot cancel an owned boot with a VM-gone observation", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`create table sandboxes (
      id text primary key, sandbox_id text, status text, health_status text,
      stop_reason text, last_boot_started_at timestamptz,
      last_boot_completed_at timestamptz
    );
    insert into sandboxes values
      ('saved', 'persistent-name', 'stopped', 'stopped', 'manual', null, null);`);
    // The pre-migration release makes this same unfenced write. It must stay
    // harmless while that release coexists with the new resume route.
    const migration = new URL(
      "../../neon/migrations/20261011173500_sandbox_boot_reconciliation.sql",
      import.meta.url
    );
    await db.exec(await readFile(migration, "utf8"));
    for (const status of ["creating", "installing"]) {
      await db.query(
        "update sandboxes set status=$1,health_status='starting',stop_reason=null,last_boot_started_at=now(),last_boot_completed_at=null",
        [status]
      );
      const stale = await db.query(
        "update sandboxes set status='stopped',health_status='stopped',stop_reason='vm_gone' where status in ('creating','installing','running') returning id"
      );
      expect(stale.rows).toEqual([]);
      expect(
        (
          await db.query(
            "select status,health_status,stop_reason from sandboxes"
          )
        ).rows
      ).toEqual([{ status, health_status: "starting", stop_reason: null }]);
      // Explicit stop and existing stuck-boot recovery still own termination.
      for (const reason of ["manual", "stuck_boot", "billing_depleted"]) {
        await db.query("update sandboxes set status=$1,stop_reason=null", [
          status,
        ]);
        expect(
          (
            await db.query(
              "update sandboxes set status='stopped',stop_reason=$1 returning id",
              [reason]
            )
          ).rows
        ).toEqual([{ id: "saved" }]);
      }
    }
    await db.exec(
      "update sandboxes set status='running',last_boot_completed_at=now()"
    );
    expect(
      (
        await db.query(
          "update sandboxes set status='stopped',stop_reason='vm_gone' returning id"
        )
      ).rows
    ).toEqual([{ id: "saved" }]);
  } finally {
    await db.close();
  }
});
