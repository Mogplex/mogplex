export type ParsedCommand = { name: string; argument: string };

export function parseCommand(payload: {
  command: string;
  text: string;
}): ParsedCommand | null {
  const command = payload.command.trim().toLowerCase();
  if (command === "/model" || command === "/harness") {
    return { name: command.slice(1), argument: payload.text.trim() };
  }
  if (command !== "/mogplex") return null;
  const [rawName = "help", ...rest] = payload.text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const name = rawName.toLowerCase();
  const aliases: Record<string, string> = {
    issue: "issues",
    pr: "prs",
    repository: "repo",
    runs: "status",
  };
  return { name: aliases[name] ?? name, argument: rest.join(" ") };
}
