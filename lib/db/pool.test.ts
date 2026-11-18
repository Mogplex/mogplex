import { once } from "node:events";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getNeonPool } from "./pool";
import { startDisconnectServer } from "@/tests/support/pg-disconnect-server";

let server: Awaited<ReturnType<typeof startDisconnectServer>>;
const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

beforeAll(async () => {
  server = await startDisconnectServer();
  vi.stubEnv("MOGPLEX_RUNTIME_DATABASE_URL", server.url);
});

afterAll(async () => {
  await getNeonPool().end();
  await server.close();
  vi.unstubAllEnvs();
  warning.mockRestore();
});

it("handles idle pool errors without throwing or logging the attached client", () => {
  const error = Object.assign(new Error("Connection terminated unexpectedly"), {
    code: "ECONNRESET",
    client: { password: "private-client-field" },
  });
  expect(() => getNeonPool().emit("error", error)).not.toThrow();
  expect(warning).toHaveBeenCalledWith(
    "[db/pool] Idle connection failed; removed from pool",
    { name: "Error", message: error.message, code: "ECONNRESET" }
  );
});

it("replaces a disconnected idle connection for the next query", async () => {
  const pool = getNeonPool();
  await expect(pool.query("SELECT 1")).resolves.toMatchObject({
    command: "SELECT",
  });
  expect(pool.idleCount).toBe(1);
  const connectionCount = server.connections;
  const disconnected = once(pool, "error");
  server.disconnect();
  await disconnected;
  expect(pool.totalCount).toBe(0);
  await expect(pool.query("SELECT 1")).resolves.toMatchObject({
    command: "SELECT",
  });
  expect(server.connections).toBe(connectionCount + 1);
});

it("still rejects an active query on disconnect without replaying it", async () => {
  const pool = getNeonPool();
  const connectionCount = server.connections;
  await expect(pool.query("SELECT disconnect")).rejects.toThrow(
    "Connection terminated unexpectedly"
  );
  expect(server.connections).toBe(connectionCount);
  await expect(pool.query("SELECT 1")).resolves.toMatchObject({
    command: "SELECT",
  });
  expect(server.connections).toBe(connectionCount + 1);
});
