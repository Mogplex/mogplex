import { createClient } from "@supabase/supabase-js";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";
import { resumeRunSandbox } from "./run-resume-sandbox";

beforeEach(() => vi.stubEnv("INTERNAL_API_SECRET", "fixture-internal-secret"));
afterEach(() => vi.unstubAllEnvs());
function fixture(status: string, persistent = true) {
  const run = buildRunRow({
    sandbox_record_id: "saved-record",
    sandbox_id: "saved-vm",
  });
  const urls: URL[] = [];
  const state = { missing: false };
  const record = {
    id: "saved-record",
    sandbox_id: "saved-vm",
    status,
    persistent,
    product_team_id: null,
  };
  const client = createClient("https://database.example.test", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url) => {
        urls.push(new URL(String(url)));
        return Response.json(state.missing ? null : record);
      },
    },
  });
  const resume = vi
    .fn<(request: Request, recordId: string) => Promise<Response>>()
    .mockResolvedValue(Response.json({ sandbox: record }));
  return { run, state, urls, deps: { client, resume } };
}
it("reuses a running owned workspace without rotating or recreating it", async () => {
  const { run, deps, urls } = fixture("running");
  expect(await resumeRunSandbox(run, deps)).toEqual({
    recordId: "saved-record",
    sandboxId: "saved-vm",
  });
  expect(urls[0].searchParams.get("id")).toBe("eq.saved-record");
  expect(urls[0].searchParams.get("user_id")).toBe(`eq.${run.user_id}`);
  expect(urls[0].searchParams.get("repo_id")).toBe(`eq.${run.repo_id}`);
  expect(deps.resume).not.toHaveBeenCalled();
});
it.each(["paused", "stopped"])(
  "wakes a %s persistent checkpoint through an authenticated resume request",
  async (status) => {
    const { run, deps } = fixture(status);
    expect(await resumeRunSandbox(run, deps)).toEqual({
      recordId: "saved-record",
      sandboxId: "saved-vm",
    });
    expect(deps.resume.mock.calls[0][1]).toBe("saved-record");
    expect(
      deps.resume.mock.calls[0][0].headers.get("x-delegated-user-id")
    ).toBe(run.user_id);
  }
);
it.each(["pausing", "error"])(
  "preserves an unavailable %s workspace rather than creating a fresh checkout",
  async (status) => {
    const { run, deps } = fixture(status);
    await expect(resumeRunSandbox(run, deps)).rejects.toThrow(
      "cannot resume yet"
    );
    expect(deps.resume).not.toHaveBeenCalled();
  }
);
it("reports missing, foreign, and nonpersistent workspaces without replacing them", async () => {
  const { run, deps, state } = fixture("paused", false);
  await expect(resumeRunSandbox(run, deps)).rejects.toThrow(
    "cannot resume yet"
  );
  state.missing = true;
  await expect(resumeRunSandbox(run, deps)).rejects.toThrow("unavailable");
  await expect(
    resumeRunSandbox({ ...run, sandbox_record_id: null }, deps)
  ).rejects.toThrow("no saved workspace");
  expect(deps.resume).not.toHaveBeenCalled();
});
it("propagates provider restore errors and leaves the saved reference intact", async () => {
  const { run, deps } = fixture("paused");
  deps.resume.mockResolvedValue(
    Response.json({ error: "Snapshot unavailable" }, { status: 502 })
  );
  await expect(resumeRunSandbox(run, deps)).rejects.toThrow(
    "Snapshot unavailable"
  );
  expect(run.sandbox_id).toBe("saved-vm");
});
