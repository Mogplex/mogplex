import { expect, it } from "vitest";
import { parsePnpmWorkspaceGlobs } from "./monorepo-detection";

it.each([
  'packages: ["apps/*", "!apps/legacy"]',
  'packages:\n  - "apps/*" # applications\n  - "!apps/legacy" # excluded\n',
])("parses pnpm lists and comments consistently", (text) => {
  expect(parsePnpmWorkspaceGlobs(text)).toEqual(["apps/*", "!apps/legacy"]);
});

it.each(["[invalid", "packages: null", "packages: [1, false]", "catalog: {}"])(
  "ignores malformed or non-string workspace declarations (%s)",
  (text) => {
    expect(parsePnpmWorkspaceGlobs(text)).toEqual([]);
  }
);
