import { describe, expect, it } from "vitest";
import { createStorageShim } from "./storage";

describe("Neon storage removal failures", () => {
  it("reports database errors instead of throwing after an icon update", async () => {
    const storage = createStorageShim({
      query: async () => {
        throw Object.assign(new Error("permission denied"), { code: "42501" });
      },
    });
    const result = await storage.from("team-icons").remove(["team/icon.png"]);
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      message: "permission denied",
      code: "42501",
    });
  });

  it("an empty removal is a no-op even when the database is unavailable", async () => {
    const storage = createStorageShim({
      query: async () => {
        throw new Error("database unavailable");
      },
    });
    expect(await storage.from("team-icons").remove([])).toEqual({
      data: [],
      error: null,
    });
  });
});
