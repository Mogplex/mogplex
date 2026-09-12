import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  createSourceFile,
  ScriptTarget,
  isIdentifier,
  forEachChild,
  type Node,
} from "typescript";
import { expect, it } from "vitest";

// A cross-surface policy guard: runtime tests exercise completion/cancellation;
// this prevents a separate runner or editor from quietly restoring a step cap.
it("no production surface configures an agent step budget", () => {
  const forbidden = new Set([
    "stepCountIs",
    "isStepCount",
    "maxSteps",
    "maxStepsOverride",
    "max_steps",
    "MAX_STEPS",
    "FLOW_ASSISTANT_MAX_STEPS",
  ]);
  const violations: string[] = [];
  const visitDirectory = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(path);
        continue;
      }
      if (
        !/\.[cm]?[jt]sx?$/.test(entry.name) ||
        /\.(test|spec)\./.test(entry.name)
      )
        continue;
      const source = createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ScriptTarget.Latest,
        true
      );
      const visitNode = (node: Node) => {
        if (
          isIdentifier(node) &&
          (forbidden.has(node.text) || /(?:^|_)MAX_STEPS$/.test(node.text))
        ) {
          violations.push(
            `${relative(process.cwd(), path)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.text}`
          );
        }
        forEachChild(node, visitNode);
      };
      visitNode(source);
    }
  };
  for (const directory of ["lib", "app", "components", "trigger", "scripts"])
    visitDirectory(join(process.cwd(), directory));
  expect(violations).toEqual([]);
});
