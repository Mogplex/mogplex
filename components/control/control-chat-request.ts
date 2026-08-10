import type { ComposerSendOptions } from "./composer";

export function buildControlChatMessage(
  text: string,
  options: ComposerSendOptions
) {
  if (!text.trim()) {
    return { files: options.files };
  }

  return {
    text,
    ...(options.files.length > 0 ? { files: options.files } : {}),
  };
}

export function buildControlChatBody(input: {
  model: string | null;
  scope: string;
  target: string;
  permissions: string;
  mode: ComposerSendOptions["mode"];
}) {
  return {
    model: input.model ?? undefined,
    scope: input.scope,
    target: input.target,
    permissions: input.permissions,
    mode: input.mode,
  };
}

export function describeAttachments(count: number) {
  if (count === 0) return "";
  return `\n\n${count} attachment${count === 1 ? "" : "s"} included.`;
}
