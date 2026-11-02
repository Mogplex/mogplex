import { posix } from "node:path";
import type { CheckKind, PlannedRepositoryCheck } from "./plan";

/** Attest only an unmodified full project script in the inspected directory. */
export function matchRepositoryCheckCommand(
  command: string,
  cwd: string | undefined,
  plan: PlannedRepositoryCheck[],
  projectDirectory?: string
): CheckKind | null {
  const sameDirectory =
    ["", ".", "./"].includes(cwd ?? "") ||
    (cwd?.startsWith("/") &&
      projectDirectory?.startsWith("/") &&
      posix.resolve(projectDirectory, cwd ?? ".") ===
        posix.resolve(projectDirectory));
  if (!sameDirectory || /[\r\n]/.test(command)) return null;
  const canonical = command.trim().replace(/[ \t]+/g, " ");
  for (const check of plan) {
    const match = /^CI=1 (npm|pnpm|yarn|bun) run ([\w:-]+)$/.exec(
      check.command ?? ""
    );
    if (!match) continue;
    const [, manager, script] = match;
    const forms = [`${manager} run ${script}`];
    if (manager !== "npm" || script === "test")
      forms.push(`${manager} ${script}`);
    if (
      forms.some((form) => canonical === form || canonical === `CI=1 ${form}`)
    )
      return check.kind;
  }
  return null;
}
