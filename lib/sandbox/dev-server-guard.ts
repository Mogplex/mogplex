export const DEV_SERVER_COMMAND_PATTERN =
  /^(pnpm|npm|yarn|bun)\s+(run\s+)?dev$|^next\s+dev|^vite(\s|$)|^nuxt\s+dev/i;

type PtyLineTrackingResult = {
  nextLine: string | null;
  submittedCommand: string | null;
};

export function shouldWarnAboutDevServerCommand(
  command: string,
  previewUrl: string | null,
  healthStatus: string | null
) {
  const normalizedCommand = command.trim();
  return Boolean(
    normalizedCommand &&
    previewUrl &&
    healthStatus === "running" &&
    DEV_SERVER_COMMAND_PATTERN.test(normalizedCommand)
  );
}

export function trackPtyCommandInput(
  currentLine: string | null,
  data: string
): PtyLineTrackingResult {
  if (data === "\r") {
    return {
      nextLine: "",
      submittedCommand: currentLine?.trim() || null,
    };
  }

  if (data === "\u0003") {
    return { nextLine: "", submittedCommand: null };
  }

  if (data === "\u007F") {
    return {
      nextLine: currentLine === null ? null : currentLine.slice(0, -1),
      submittedCommand: null,
    };
  }

  if (data.startsWith("\u001B")) {
    return { nextLine: null, submittedCommand: null };
  }

  if ([...data].every((char) => char >= " ")) {
    return {
      nextLine: currentLine === null ? null : currentLine + data,
      submittedCommand: null,
    };
  }

  return { nextLine: null, submittedCommand: null };
}
