// Self-hosted cron runner. Vercel schedules the routes in vercel.json for the
// hosted app; outside Vercel, nothing does. This dependency-free script reads
// the same schedules and calls each route with the CRON_SECRET bearer token.
//
//   CRON_SECRET=... CRON_TARGET_URL=http://app:3000 node scripts/self-host-cron.mjs
//
// docker-compose.yml runs it as the `cron` service.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* eslint-disable unicorn/prefer-import-meta-properties */
const CURRENT_FILENAME = import.meta.filename ?? fileURLToPath(import.meta.url);
const CURRENT_DIR = import.meta.dirname ?? path.dirname(CURRENT_FILENAME);
/* eslint-enable unicorn/prefer-import-meta-properties */

/** @typedef {{ path: string; schedule: string; parsed: Set<number>[] }} CronJob */
/** @typedef {{ info: (message: string) => void; error: (message: string) => void }} CronLog */

const FIELD_RANGES = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0 = Sunday)
];

function parseNumber(value, range) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid cron value: ${value}`);
  const number = Number(value);
  if (number < range.min || number > range.max) {
    throw new Error(`Cron value out of range: ${value}`);
  }
  return number;
}

// `5` alone means just minute 5; `5/10` means every 10th value from 5 on.
function openRangeEnd(start, stepText, range) {
  return stepText === undefined ? start : range.max;
}

function parsePart(part, range) {
  const [base, stepText] = part.split("/");
  const step =
    stepText === undefined
      ? 1
      : parseNumber(stepText, { min: 1, max: range.max });
  let start = range.min;
  let end = range.max;
  if (base !== "*") {
    const [low, high] = base.split("-");
    start = parseNumber(low, range);
    end =
      high === undefined
        ? openRangeEnd(start, stepText, range)
        : parseNumber(high, range);
  }
  const values = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

/**
 * Parse a five-field cron expression (minute hour day-of-month month
 * day-of-week) supporting `*`, numbers, `a-b` ranges, `/n` steps, and comma
 * lists. Returns one Set of allowed values per field.
 */
export function parseCronExpression(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields: ${expression}`);
  }
  return fields.map((field, index) => {
    const values = new Set();
    for (const part of field.split(",")) {
      for (const value of parsePart(part, FIELD_RANGES[index]))
        values.add(value);
    }
    return values;
  });
}

/** True when the schedule fires in the UTC minute that contains `date`. */
export function cronMatches(schedule, date) {
  const actual = [
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
    date.getUTCDay(),
  ];
  return schedule.every((allowed, index) => allowed.has(actual[index]));
}

/**
 * Read the `crons` array from vercel.json and parse each schedule.
 * @param {string} vercelJsonPath
 * @returns {Promise<CronJob[]>}
 */
export async function loadCronJobs(vercelJsonPath) {
  const config = JSON.parse(await readFile(vercelJsonPath, "utf8"));
  return (config.crons ?? []).map((job) => ({
    path: job.path,
    schedule: job.schedule,
    parsed: parseCronExpression(job.schedule),
  }));
}

/**
 * The jobs whose schedule fires in the minute that contains `date`.
 * @param {CronJob[]} jobs
 * @param {Date} date
 * @returns {CronJob[]}
 */
export function dueJobs(jobs, date) {
  return jobs.filter((job) => cronMatches(job.parsed, date));
}

/** @type {CronLog} */
const defaultLog = {
  info: (message) => process.stdout.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`),
};

/**
 * Call one cron route. Failures are logged and never stop the runner.
 * @param {CronJob} job
 * @param {{
 *   targetUrl: string;
 *   secret: string;
 *   fetchImpl?: (url: URL, init: RequestInit) => Promise<Response>;
 *   log?: CronLog;
 * }} options
 * @returns {Promise<number | null>} the response status, or null on a network failure
 */
export async function runJob(
  job,
  { targetUrl, secret, fetchImpl = fetch, log = defaultLog }
) {
  const url = new URL(job.path, targetUrl);
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    log.info(`[cron] ${job.path} -> ${response.status}`);
    return response.status;
  } catch (error) {
    log.error(
      `[cron] ${job.path} failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

function millisecondsUntilNextMinute(now) {
  return 60_000 - (now.getTime() % 60_000) + 50;
}

async function main() {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    throw new Error("CRON_SECRET is required");
  }
  const targetUrl =
    process.env.CRON_TARGET_URL?.trim() || "http://127.0.0.1:3000";
  const vercelJsonPath =
    process.env.CRON_CONFIG_PATH?.trim() ||
    path.resolve(CURRENT_DIR, "../vercel.json");
  const jobs = await loadCronJobs(vercelJsonPath);
  defaultLog.info(
    `[cron] ${jobs.length} jobs from ${vercelJsonPath}, calling ${targetUrl}`
  );

  const tick = async () => {
    const now = new Date();
    await Promise.all(
      dueJobs(jobs, now).map((job) => runJob(job, { targetUrl, secret }))
    );
    setTimeout(tick, millisecondsUntilNextMinute(new Date()));
  };
  setTimeout(tick, millisecondsUntilNextMinute(new Date()));
}

if (process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILENAME) {
  // The unit-test runner transpiles this module to CJS, where top-level await
  // is unavailable (same pattern as check-merge-group-triggers.mjs).
  // eslint-disable-next-line unicorn/prefer-top-level-await
  void (async () => {
    try {
      await main();
    } catch (error) {
      defaultLog.error(
        `[cron] ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    }
  })();
}
