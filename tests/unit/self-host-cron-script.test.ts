import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  cronMatches,
  dueJobs,
  loadCronJobs,
  parseCronExpression,
  runJob,
} from "../../scripts/self-host-cron.mjs";

const at = (iso: string) => new Date(iso);

test("parseCronExpression supports wildcards, steps, ranges, and lists", () => {
  const [minutes, hours, days, months, weekdays] = parseCronExpression(
    "*/15 6,18 1-3 * 1-5/2"
  );

  assert.deepEqual([...minutes], [0, 15, 30, 45]);
  assert.deepEqual([...hours], [6, 18]);
  assert.deepEqual([...days], [1, 2, 3]);
  assert.equal(months.size, 12);
  assert.deepEqual([...weekdays], [1, 3, 5]);
});

test("parseCronExpression rejects malformed expressions", () => {
  assert.throws(() => parseCronExpression("* * * *"), /5 fields/);
  assert.throws(() => parseCronExpression("60 * * * *"), /out of range/);
  assert.throws(() => parseCronExpression("x * * * *"), /Invalid cron value/);
});

test("cronMatches evaluates schedules in UTC", () => {
  const daily = parseCronExpression("0 6 * * *");
  assert.equal(cronMatches(daily, at("2026-10-12T06:00:30Z")), true);
  assert.equal(cronMatches(daily, at("2026-10-12T06:01:00Z")), false);
  assert.equal(cronMatches(daily, at("2026-10-12T07:00:00Z")), false);
});

test("loadCronJobs reads every vercel.json cron and dueJobs selects the minute's jobs", async () => {
  const jobs = await loadCronJobs(path.resolve("vercel.json"));
  assert.ok(jobs.length >= 5);
  assert.ok(jobs.every((job) => job.path.startsWith("/api/cron/")));

  const fiveMinuteJobs = dueJobs(jobs, at("2026-10-12T10:05:00Z"));
  assert.ok(
    fiveMinuteJobs.some((job) => job.path === "/api/cron/sandbox-reaper")
  );
  assert.ok(
    !fiveMinuteJobs.some((job) => job.path === "/api/cron/sync-models")
  );
  assert.equal(dueJobs(jobs, at("2026-10-12T10:07:00Z")).length, 0);
});

test("runJob sends the bearer secret and survives a failed request", async () => {
  const silent = { info: () => {}, error: () => {} };
  const job = {
    path: "/api/cron/repair-jobs",
    schedule: "*/5 * * * *",
    parsed: [],
  };
  let seen: { url: string; auth: string | null } | null = null;

  const status = await runJob(job, {
    targetUrl: "https://app.example",
    secret: "cron-secret",
    log: silent,
    fetchImpl: async (url: URL, init: RequestInit) => {
      seen = {
        url: url.toString(),
        auth: new Headers(init.headers).get("authorization"),
      };
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(status, 204);
  assert.deepEqual(seen, {
    url: "https://app.example/api/cron/repair-jobs",
    auth: "Bearer cron-secret",
  });

  const failed = await runJob(job, {
    targetUrl: "https://app.example",
    secret: "cron-secret",
    log: silent,
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(failed, null);
});
