import { expect, it } from "vitest";
import {
  buildRoutes,
  withDatabase,
} from "../support/sandbox-pause-race-harness";

it("starts the pause recovery clock at the claim rather than the sandbox's old activity", async () => {
  await withDatabase(async (pg) => {
    let age: number | undefined;
    const routes = buildRoutes(
      pg,
      async () => {
        age = (
          await pg.query<{ age: number }>(
            "select extract(epoch from now() - last_active_at)::float8 as age from sandboxes"
          )
        ).rows[0].age;
      },
      async () => "stopped"
    );
    expect((await routes.pause()).status).toBe(200);
    expect(age).toBeLessThan(60);
  });
});

it.each(["running", "stopped"])(
  "preserves pause intent while a fresh detail probe sees provider %s",
  async (providerStatus) => {
    await withDatabase(async (pg) => {
      let duringPause: string | undefined;
      const routes = buildRoutes(
        pg,
        async () => {
          duringPause = (await (await routes.detail()).json()).sandbox
            .runtime_summary.status;
        },
        async () => providerStatus
      );
      const response = await routes.pause();
      expect(response.status).toBe(200);
      expect((await response.json()).sandbox.runtime_summary.status).toBe(
        "paused"
      );
      expect(duringPause).toBe("pausing");
      expect(
        (await pg.query("select status, snapshot_id from sandboxes")).rows
      ).toEqual([{ status: "paused", snapshot_id: "snap_saved" }]);
    });
  }
);

it("a detail probe started before pause cannot overwrite the claim or return stale stopped state", async () => {
  await withDatabase(async (pg) => {
    let started!: () => void;
    let release!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const probeReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detailResponse: Response | undefined;
    const routes = buildRoutes(
      pg,
      async () => {
        release();
        detailResponse = await pendingDetail;
      },
      async () => {
        started();
        await probeReleased;
        return "stopped";
      }
    );
    const pendingDetail = routes.detail();
    await probeStarted;
    const response = await routes.pause();
    expect(response.status).toBe(200);
    expect((await response.json()).sandbox.runtime_summary.status).toBe(
      "paused"
    );
    expect((await detailResponse!.json()).sandbox.runtime_summary.status).toBe(
      "pausing"
    );
    expect((await pg.query("select status from sandboxes")).rows).toEqual([
      { status: "paused" },
    ]);
  });
});

it.each(["stopped", "installing"])(
  "does not claim pause succeeded when a concurrent action changes state to %s",
  async (status) => {
    await withDatabase(async (pg) => {
      const routes = buildRoutes(
        pg,
        async () => {
          await pg.query("update sandboxes set status = $1", [status]);
        },
        async () => "stopped"
      );
      const response = await routes.pause();
      expect(response.status).toBe(409);
      expect((await pg.query("select status from sandboxes")).rows).toEqual([
        { status },
      ]);
    });
  }
);

it.each([false, true])(
  "provider failure restores only its own pause claim (superseded=%s)",
  async (superseded) => {
    await withDatabase(async (pg) => {
      const routes = buildRoutes(
        pg,
        async () => {
          if (superseded)
            await pg.query("update sandboxes set status = 'installing'");
          throw new Error("provider stop failed");
        },
        async () => "running"
      );
      expect((await routes.pause()).status).toBe(500);
      expect((await pg.query("select status from sandboxes")).rows).toEqual([
        { status: superseded ? "installing" : "running" },
      ]);
    });
  }
);

it("a stale running probe cannot overwrite a newer pause claim", async () => {
  await withDatabase(async (pg) => {
    await pg.query("update sandboxes set status = 'stopped'");
    const routes = buildRoutes(
      pg,
      async () => {},
      async () => {
        await pg.query(
          "update sandboxes set status = 'pausing', health_status = 'pausing'"
        );
        return "running";
      }
    );
    const response = await routes.detail();
    expect(response.status).toBe(200);
    expect((await response.json()).sandbox.runtime_summary.status).toBe(
      "pausing"
    );
    expect((await pg.query("select status from sandboxes")).rows).toEqual([
      { status: "pausing" },
    ]);
  });
});
