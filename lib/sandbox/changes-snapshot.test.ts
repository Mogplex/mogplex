import { expect, it } from "vitest";
import { parseWorkspaceDiffs } from "./changes-snapshot";

it("decodes framed patches including an empty final patch and rejects missing or mismatched rows", () => {
  const patch = "--- a/run-gallery.tsx\n+++ b/run-gallery.tsx\n+supabase\n";
  expect(
    parseWorkspaceDiffs(`0\t${Buffer.from(patch).toString("base64")}\n1\t\n`, 2)
  ).toEqual([patch, ""]);
  expect(() => parseWorkspaceDiffs("0\t\n", 2)).toThrow(/incomplete/);
  expect(() => parseWorkspaceDiffs("1\t\n", 1)).toThrow(/invalid/);
});
