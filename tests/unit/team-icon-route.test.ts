import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createTeamIconHandlers } from "../../app/api/teams/[teamId]/icon/route";
import type { TeamRole } from "../../lib/team-capabilities";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";

const teamId = "00000000-0000-4000-8000-000000000001";
const context = (id = teamId) => ({ params: Promise.resolve({ teamId: id }) });
const previousBackend = process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND;
process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND = "neon";
after(() => {
  if (previousBackend === undefined)
    delete process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND;
  else process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND = previousBackend;
});
const png = Buffer.from("89504e470d0a1a0a0000000000000000", "hex");
const multipart = (value?: File | string) => {
  const form = new FormData();
  if (value !== undefined) form.set("file", value);
  return new Request("http://localhost", { method: "POST", body: form });
};
function fixture(
  options: {
    actor?: TeamRole;
    previous?: string;
    failUpload?: boolean;
    failWrite?: boolean;
    failRemove?: boolean;
    failRead?: boolean;
  } = {}
) {
  const events: string[] = [];
  const uploads: { path: string; bytes: Buffer; headers: Headers }[] = [];
  const writes: { icon_path: string | null }[] = [];
  const removals: string[][] = [];
  const audits: RecordTeamAuditEventInput[] = [];
  const db = createClient("https://database.example", "unit-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (url.pathname === "/rest/v1/teams") {
          assert.equal(url.searchParams.get("id"), `eq.${teamId}`);
          if (method === "PATCH") {
            events.push("write");
            writes.push(
              JSON.parse(String(init?.body)) as { icon_path: string | null }
            );
            return options.failWrite
              ? Response.json(
                  { message: "Write failed", code: "XX000" },
                  { status: 500 }
                )
              : new Response(null, { status: 204 });
          }
          events.push("read");
          return options.failRead
            ? Response.json(
                { message: "Read failed", code: "XX000" },
                { status: 500 }
              )
            : Response.json([{ icon_path: options.previous ?? null }]);
        }
        if (method === "POST") {
          events.push("upload");
          const path = url.pathname.replace(
            "/storage/v1/object/team-icons/",
            ""
          );
          assert.ok(path.startsWith(`${teamId}/`));
          assert.ok(Buffer.isBuffer(init?.body));
          uploads.push({
            path,
            bytes: Buffer.from(init.body as Buffer),
            headers: new Headers(init.headers),
          });
          return options.failUpload
            ? Response.json(
                { message: "Upload failed", statusCode: "500" },
                { status: 500 }
              )
            : Response.json({ Key: `team-icons/${path}` });
        }
        assert.equal(method, "DELETE");
        assert.equal(url.pathname, "/storage/v1/object/team-icons");
        events.push("remove");
        const body = JSON.parse(String(init?.body)) as { prefixes: string[] };
        removals.push(body.prefixes);
        return options.failRemove
          ? Response.json(
              { message: "Removal failed", statusCode: "500" },
              { status: 500 }
            )
          : Response.json([]);
      },
    },
  });
  const actor = options.actor ?? "owner";
  const deps = {
    db,
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: true as const,
      role: actor,
      canManage: actor === "owner" || actor === "admin",
    }),
    recordTeamAuditEvent: async (input: RecordTeamAuditEventInput) => {
      audits.push(input);
      events.push("audit");
      return { ok: true as const };
    },
  };
  return {
    deps,
    handlers: createTeamIconHandlers(deps),
    events,
    uploads,
    writes,
    removals,
    audits,
  };
}

for (const [hex, ext, mime] of [
  [png.toString("hex"), "png", "image/png"],
  ["ffd8ff0000000000", "jpg", "image/jpeg"],
  ["4749463837610000", "gif", "image/gif"],
  ["4749463839610000", "gif", "image/gif"],
  ["52494646000000005745425000000000", "webp", "image/webp"],
]) {
  test(`icon POST recognizes ${hex} from bytes rather than client MIME or filename`, async () => {
    const previous = `${teamId}/old.png`;
    const f = fixture({ actor: "admin", previous });
    const bytes = Buffer.from(hex!, "hex");
    const response = await f.handlers.POST(
      multipart(new File([bytes], "pretend.svg", { type: "image/svg+xml" })),
      context()
    );
    assert.equal(response.status, 200);
    const upload = f.uploads[0]!;
    assert.match(
      upload.path,
      new RegExp(`^${teamId}/\\d+-[0-9a-f]{8}\\.${ext}$`)
    );
    assert.deepEqual(upload.bytes, bytes);
    assert.equal(upload.headers.get("content-type"), mime);
    assert.equal(upload.headers.get("cache-control"), "max-age=3600");
    assert.equal(upload.headers.get("x-upsert"), "false");
    assert.deepEqual(f.writes, [{ icon_path: upload.path }]);
    assert.deepEqual(f.removals, [[previous]]);
    assert.deepEqual(f.events, ["read", "upload", "write", "remove", "audit"]);
    assert.deepEqual(await response.json(), {
      icon_url: `/storage/v1/object/public/team-icons/${upload.path}`,
    });
    assert.deepEqual(f.audits, [
      {
        productTeamId: teamId,
        actorUserId: "user-1",
        action: "team.icon.updated",
        targetType: "team",
        targetId: teamId,
        payload: { icon_path: upload.path },
      },
    ]);
  });
}

for (const [label, value] of [
  ["missing", undefined],
  ["text", "image"],
  ["empty", new File([], "empty.png")],
] as const) {
  test(`icon POST rejects ${label} form file with flattened errors before storage access`, async () => {
    const f = fixture();
    const response = await f.handlers.POST(multipart(value), context());
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid icon file.");
    assert.ok(result.details.fieldErrors.file.length > 0);
    assert.deepEqual(f.events, []);
  });
}

test("icon POST retains malformed multipart at 400", async () => {
  const f = fixture();
  const response = await f.handlers.POST(
    new Request("http://localhost", { method: "POST", body: "{" }),
    context()
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Expected multipart/form-data",
  });
  assert.deepEqual(f.events, []);
});

for (const size of [2 * 1024 * 1024, 2 * 1024 * 1024 + 1]) {
  test(`icon POST preserves existing 2 MiB size boundary at ${size}`, async () => {
    const f = fixture();
    const bytes = Buffer.alloc(size);
    png.copy(bytes);
    const response = await f.handlers.POST(
      multipart(new File([bytes], "image.png")),
      context()
    );
    assert.equal(response.status, size === 2 * 1024 * 1024 ? 200 : 413);
    if (size > 2 * 1024 * 1024) assert.deepEqual(f.events, []);
    else assert.equal(f.uploads[0]?.bytes.length, size);
  });
}

for (const bytes of [
  "<svg><script>bad</script></svg>",
  "<html>bad</html>",
  "RIFFxxxxNOPE",
  "x",
]) {
  test(`icon POST rejects unsupported bytes even with PNG MIME: ${bytes}`, async () => {
    const f = fixture();
    const response = await f.handlers.POST(
      multipart(new File([bytes], "image.png", { type: "image/png" })),
      context()
    );
    assert.equal(response.status, 415);
    assert.deepEqual(f.events, []);
  });
}

for (const method of ["POST", "DELETE"] as const) {
  const req = () => multipart(new File([png], "image.png"));
  test(`icon ${method} signs in before validation`, async () => {
    const f = fixture();
    const handlers = createTeamIconHandlers({
      ...f.deps,
      requireProfileId: async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      loadTeamMembershipAuth: async () => {
        throw new Error("Unexpected membership read");
      },
    });
    assert.equal(
      (await handlers[method](req(), context("bad-team"))).status,
      401
    );
    assert.deepEqual(f.events, []);
  });
  test(`icon ${method} rejects invalid team UUID before membership and storage`, async () => {
    const f = fixture();
    const handlers = createTeamIconHandlers({
      ...f.deps,
      loadTeamMembershipAuth: async () => {
        throw new Error("Unexpected membership read");
      },
    });
    const response = await handlers[method](req(), context("bad-team"));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid team ID.",
      details: { formErrors: [], fieldErrors: { teamId: ["Invalid uuid"] } },
    });
    assert.deepEqual(f.events, []);
  });
  for (const actor of ["developer", "viewer"] as const) {
    test(`icon ${method} rejects ${actor} before multipart parsing`, async () => {
      const f = fixture({ actor });
      assert.equal(
        (await f.handlers[method](new Request("http://localhost"), context()))
          .status,
        403
      );
      assert.deepEqual(f.events, []);
    });
  }
  for (const status of [403, 404, 500] as const) {
    test(`icon ${method} preserves membership failure ${status}`, async () => {
      const f = fixture();
      const handlers = createTeamIconHandlers({
        ...f.deps,
        loadTeamMembershipAuth: async () => ({
          ok: false as const,
          error: "Membership failed",
          status,
        }),
      });
      assert.equal((await handlers[method](req(), context())).status, status);
      assert.deepEqual(f.events, []);
    });
  }
  test(`icon ${method} preserves write failure and only rolls back uploaded object`, async () => {
    const f = fixture({ failWrite: true, previous: `${teamId}/old.png` });
    assert.equal((await f.handlers[method](req(), context())).status, 500);
    assert.deepEqual(f.audits, []);
    assert.deepEqual(
      f.removals,
      method === "POST" ? [[f.uploads[0]?.path]] : []
    );
  });
}

test("icon POST returns upload failure without writing team or audit", async () => {
  const f = fixture({ failUpload: true });
  assert.equal(
    (await f.handlers.POST(multipart(new File([png], "image.png")), context()))
      .status,
    500
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.audits, []);
  assert.deepEqual(f.removals, []);
});

for (const failRemove of [false, true]) {
  test(`icon DELETE clears row then attempts cleanup before audit (cleanup failure ${failRemove})`, async () => {
    const previous = `${teamId}/old.png`;
    const f = fixture({ previous, failRemove });
    const response = await f.handlers.DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      context()
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { icon_url: null });
    assert.deepEqual(f.writes, [{ icon_path: null }]);
    assert.deepEqual(f.removals, [[previous]]);
    assert.deepEqual(f.events, ["read", "write", "remove", "audit"]);
    assert.equal(f.audits[0]?.action, "team.icon.removed");
    assert.deepEqual(f.audits[0]?.payload, { icon_path: previous });
  });
}

test("icon DELETE keeps empty current-icon removal idempotent", async () => {
  const f = fixture();
  assert.equal(
    (await f.handlers.DELETE(new Request("http://localhost"), context()))
      .status,
    200
  );
  assert.deepEqual(f.removals, []);
  assert.equal(f.audits.length, 1);
});

test("icon POST retains best-effort previous-icon lookup failure", async () => {
  const f = fixture({ failRead: true });
  assert.equal(
    (await f.handlers.POST(multipart(new File([png], "image.png")), context()))
      .status,
    200
  );
  assert.deepEqual(f.removals, []);
  assert.equal(f.audits.length, 1);
});
