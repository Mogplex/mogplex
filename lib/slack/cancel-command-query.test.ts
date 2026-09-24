import { beforeAll, expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";

let listRuns: typeof import("./cancel-command").listSlackCancelableRuns;
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  listRuns = (await import("./cancel-command")).listSlackCancelableRuns;
});
const scope = {
  userId: "owner",
  teamId: "T1",
  channelId: "C1",
  slackUserId: "U1",
};
const run = { id: "00000000-0000-4000-8000-000000000001", status: "streaming" };
function client(query: Parameters<typeof createPostgrestShim>[0]["query"]) {
  return createPostgrestShim({ query }) as unknown as NonNullable<
    Parameters<typeof listRuns>[1]
  >;
}
it("deduplicates the same run found through its original thread and control card", async () => {
  let calls = 0;
  expect(
    await listRuns(
      { ...scope, threadTs: "1.1" },
      client(async () => {
        calls++;
        return { rows: [run] };
      })
    )
  ).toEqual([run]);
  expect(calls).toBe(2);
});
it("does not silently use partial results when either thread query fails", async () => {
  let calls = 0;
  await expect(
    listRuns(
      { ...scope, threadTs: "1.1" },
      client(async () => {
        if (++calls === 2) throw new Error("unavailable");
        return { rows: [run] };
      })
    )
  ).rejects.toThrow("Failed to load Slack cancellation targets");
});
it("returns an empty thread without broadening the lookup", async () => {
  let calls = 0;
  expect(
    await listRuns(
      { ...scope, threadTs: "1.1" },
      client(async () => {
        calls++;
        return { rows: [] };
      })
    )
  ).toEqual([]);
  expect(calls).toBe(2);
});
it("uses the channel query when no thread is supplied", async () => {
  let calls = 0;
  expect(
    await listRuns(
      { ...scope, runId: run.id },
      client(async () => {
        calls++;
        return { rows: [run] };
      })
    )
  ).toEqual([run]);
  expect(calls).toBe(1);
});
