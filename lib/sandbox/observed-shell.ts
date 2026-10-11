import { randomUUID } from "node:crypto";

/** Observe unhandled failed shell steps without stopping the user's script.
 * pipefail exposes a failed build/test even when its output is piped to tail.
 * ERR ignores handled failures (if/! / ||), preserving normal shell probes.
 */
export function observeShellCommand(command: string, id = randomUUID()) {
  const marker = `__MOGPLEX_EXIT_${id}__`;
  const failures: number[] = [];
  let pending = "";
  const pattern = new RegExp(`${marker}(\\d+)\\n`, "g");
  const clean = (text: string) =>
    text.replace(pattern, (_match, code) => {
      failures.push(Number(code));
      return "";
    });
  return {
    cmd: "bash",
    args: [
      "-o",
      "pipefail",
      "-lc",
      `trap '__mogplex_exit=$?; printf "\\n${marker}%s\\n" "$__mogplex_exit" >&2' ERR\n${command}`,
    ],
    failures,
    stderr(chunk: string, final = false) {
      pending += chunk;
      // Hold only a possible marker split across log frames, not entire lines.
      const start = pending.lastIndexOf("\n");
      const length = final
        ? pending.length
        : Math.max(start + 1, pending.length - marker.length - 12);
      const text = pending.slice(0, length);
      pending = pending.slice(length);
      return clean(text);
    },
  };
}
