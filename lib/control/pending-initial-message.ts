import type { ComposerSendOptions } from "@/components/control/composer";
import {
  browserPendingAttachmentStore,
  type PendingAttachmentStore,
} from "./pending-message-attachments";

export const FIRST_MESSAGE_FAILURE = "Your first message was not sent";
export const INITIAL_MESSAGE_DEADLINE_MS = 10_000;
const STORAGE_PREFIX = "mogplex.control.pendingInitial.";
const ATTACHMENT_PREFIX = "mogplex-pending-attachment:";
export type PendingInitialMessage = {
  missionId: string;
  text: string;
  options: ComposerSendOptions;
  failed?: boolean;
  attachmentsMissing?: boolean;
  recovered?: boolean;
  queuedAt?: number;
};
export type PendingMessageStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export async function savePendingInitialMessage(
  storage: PendingMessageStorage,
  pending: PendingInitialMessage,
  attachments: PendingAttachmentStore = browserPendingAttachmentStore
) {
  const files = await Promise.all(
    pending.options.files.map(async (file) => {
      if (!file.url.startsWith("data:")) return file;
      const key = `${pending.missionId}:${file.id}`;
      await attachments.put(key, file.url);
      return { ...file, url: `${ATTACHMENT_PREFIX}${key}` };
    })
  );
  storage.setItem(
    `${STORAGE_PREFIX}${pending.missionId}`,
    JSON.stringify({ ...pending, options: { ...pending.options, files } })
  );
}
export async function loadPendingInitialMessage(
  storage: PendingMessageStorage,
  missionId: string,
  attachments: PendingAttachmentStore = browserPendingAttachmentStore
): Promise<PendingInitialMessage | null> {
  const value = storage.getItem(`${STORAGE_PREFIX}${missionId}`);
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as PendingInitialMessage;
    if (
      pending.missionId !== missionId ||
      typeof pending.text !== "string" ||
      !Array.isArray(pending.options?.files)
    )
      return null;
    const restoredFiles = await Promise.all(
      pending.options.files.map(async (file) => {
        if (!file.url.startsWith(ATTACHMENT_PREFIX)) return file;
        try {
          const url = await attachments.get(
            file.url.slice(ATTACHMENT_PREFIX.length)
          );
          return url ? { ...file, url } : null;
        } catch {
          return null;
        }
      })
    );
    const files = restoredFiles.filter((file) => file !== null);
    const attachmentsMissing = files.length !== restoredFiles.length;
    return {
      ...pending,
      ...(attachmentsMissing
        ? { failed: true, attachmentsMissing: true, recovered: !pending.failed }
        : {}),
      options: { ...pending.options, files },
    };
  } catch {
    return null;
  }
}
export async function removePendingInitialMessage(
  storage: PendingMessageStorage,
  missionId: string,
  attachments: PendingAttachmentStore = browserPendingAttachmentStore
) {
  const value = storage.getItem(`${STORAGE_PREFIX}${missionId}`);
  storage.removeItem(`${STORAGE_PREFIX}${missionId}`);
  if (!value) return;
  let stored: PendingInitialMessage;
  try {
    stored = JSON.parse(value) as PendingInitialMessage;
  } catch {
    return;
  }
  if (!Array.isArray(stored.options?.files)) return;
  await Promise.allSettled(
    stored.options.files
      .filter((file) => file.url.startsWith(ATTACHMENT_PREFIX))
      .map((file) =>
        attachments.remove(file.url.slice(ATTACHMENT_PREFIX.length))
      )
  );
}

/** One deadline for readiness, cancelled on readiness or lifecycle cleanup. */
export function createPendingInitialMessageDeadline(
  onFailure: () => void,
  queuedAt = Date.now()
) {
  const timer = setTimeout(
    onFailure,
    Math.max(0, queuedAt + INITIAL_MESSAGE_DEADLINE_MS - Date.now())
  );
  return {
    cancel: () => clearTimeout(timer),
  };
}

export type PendingUserTurn = {
  id: string;
  role: string;
  parts?: Array<{
    type: string;
    text?: string;
    url?: string;
    filename?: string;
    mediaType?: string;
  }>;
};
/** Replace only the matching unanswered optimistic draft, never a later turn. */
export function pendingInitialMessageRetryId(
  messages: PendingUserTurn[],
  pending: PendingInitialMessage
): string | undefined {
  const last = messages.at(-1);
  if (last?.role !== "user" || !last.parts) return undefined;
  const text = last.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
  const files = last.parts.filter((part) => part.type === "file");
  if (text !== pending.text || files.length !== pending.options.files.length)
    return undefined;
  return files.every((file, index) => {
    const draft = pending.options.files[index];
    return (
      file.url === draft.url &&
      file.mediaType === draft.mediaType &&
      file.filename === draft.filename
    );
  })
    ? last.id
    : undefined;
}

/** Assistant output after the newest matching turn proves the draft was delivered. */
export function pendingInitialMessageWasAnswered(
  messages: PendingUserTurn[],
  pending: PendingInitialMessage
): boolean {
  const index = messages.findLastIndex(
    (message) => pendingInitialMessageRetryId([message], pending) !== undefined
  );
  return (
    index !== -1 &&
    messages.slice(index + 1).some((message) => message.role === "assistant")
  );
}
