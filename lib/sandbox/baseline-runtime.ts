import type { Sandbox } from "@vercel/sandbox";
import type { SandboxRuntime } from "./runtimes/types";
import { BaselineSnapshotRestoreError } from "./baseline-errors";

/** A cached baseline can predate a repository's Node major-version change. */
export async function assertBaselineRuntime(
  sandbox: Sandbox,
  runtime: SandboxRuntime
) {
  if (runtime !== "node22" && runtime !== "node24") return;
  try {
    const result = await sandbox.runCommand({
      cmd: "node",
      args: ["-p", "process.versions.node"],
    });
    const version = (await result.stdout()).trim();
    if (result.exitCode !== 0 || version.split(".")[0] !== runtime.slice(4)) {
      throw new Error(
        `The cached baseline does not use the selected ${runtime} runtime`
      );
    }
  } catch (error) {
    throw new BaselineSnapshotRestoreError(
      "The cached baseline runtime does not match this launch",
      "runtime",
      error
    );
  }
}
