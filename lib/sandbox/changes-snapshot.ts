import { buildFileDiffScript } from "./changes";

/** One sandbox round trip; base64 frames preserve arbitrary patch contents. */
export function buildWorkspaceDiffsScript(paths: string[]) {
  return [
    "set -eu",
    'snapshot_diff="$(mktemp)"',
    "trap 'rm -f -- \"$snapshot_diff\"' EXIT",
    ...paths.map((path, index) =>
      [
        `(\n${buildFileDiffScript(path)}\n) > "$snapshot_diff"`,
        `printf '${index}\\t'`,
        "base64 < \"$snapshot_diff\" | tr -d '\\n'",
        "printf '\\n'",
      ].join("\n")
    ),
  ].join("\n");
}

export function parseWorkspaceDiffs(stdout: string, count: number): string[] {
  if (count === 0 && !stdout.trim()) return [];
  const rows = stdout.replace(/\n$/, "").split("\n");
  if (rows.length !== count)
    throw new Error("Workspace diff snapshot was incomplete.");
  return rows.map((row, index) => {
    const match = row.match(/^(\d+)\t([A-Za-z0-9+/=]*)$/);
    if (!match || Number(match[1]) !== index)
      throw new Error("Workspace diff snapshot was invalid.");
    return Buffer.from(match[2], "base64").toString("utf8");
  });
}
