import type { RunChatAgentMessage } from "@/lib/agents/run-chat";
import {
  SLACK_IMAGE_ATTACHMENT_FETCH_TIMEOUT_MS,
  SLACK_IMAGE_ATTACHMENT_MAX_BYTES,
  SLACK_IMAGE_ATTACHMENT_MAX_COUNT,
} from "@/lib/slack/run-attachments";
import type {
  SlackEventAttachment,
  SlackEventAttachmentNotice,
  SlackEventTaskDeps,
  SlackEventTaskPayload,
  PreparedSlackAttachments,
  PreparedSlackRepoAgentAttachments,
} from "./types";

function logSlackAttachmentSkipped(input: {
  reason: "size" | "fetch_failed";
  attachmentId: string;
  mimetype: string;
  sizeBytes?: number;
  error?: unknown;
}) {
  console.warn("[slack-event] slack.attachment.skipped", input);
}

function appendSlackAttachmentNotices(text: string, notices: string[]): string {
  if (notices.length === 0) return text;
  return [text, ...notices].filter(Boolean).join("\n\n");
}

function buildSlackAttachmentPayloadNotices(
  notices: SlackEventAttachmentNotice[] | undefined
): string[] {
  return (notices ?? []).map((notice) => {
    if (notice.reason === "count_cap") {
      return `(showing first ${SLACK_IMAGE_ATTACHMENT_MAX_COUNT} of ${
        notice.count + SLACK_IMAGE_ATTACHMENT_MAX_COUNT
      } attached images)`;
    }
    return "";
  });
}

function isTooLarge(sizeBytes: number | undefined): boolean {
  return (
    typeof sizeBytes === "number" &&
    Number.isFinite(sizeBytes) &&
    sizeBytes > SLACK_IMAGE_ATTACHMENT_MAX_BYTES
  );
}

function responseContentLength(response: Response): number | undefined {
  const header = response.headers.get("content-length");
  if (!header) return undefined;
  const parsed = Number(header);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fetchSlackAttachmentDataUrl(input: {
  deps: Pick<SlackEventTaskDeps, "fetchAttachment">;
  botToken: string;
  attachment: SlackEventAttachment;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SLACK_IMAGE_ATTACHMENT_FETCH_TIMEOUT_MS
  );
  try {
    const response = await input.deps.fetchAttachment({
      botToken: input.botToken,
      url: input.attachment.urlPrivateDownload,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Slack file fetch failed with ${response.status}`);
    }
    const contentLength = responseContentLength(response);
    if (isTooLarge(contentLength)) {
      throw new RangeError("Slack file is too large");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > SLACK_IMAGE_ATTACHMENT_MAX_BYTES) {
      throw new RangeError("Slack file is too large");
    }
    return `data:${input.attachment.mimetype};base64,${bytes.toString(
      "base64"
    )}`;
  } finally {
    clearTimeout(timeout);
  }
}

export async function prepareSlackAttachments(input: {
  deps: Pick<SlackEventTaskDeps, "fetchAttachment">;
  botToken: string;
  payload: Pick<
    SlackEventTaskPayload,
    "attachments" | "attachmentNotices" | "attachmentDroppedCount"
  >;
}): Promise<PreparedSlackAttachments> {
  const contentParts: PreparedSlackAttachments["contentParts"] = [];
  const notices = buildSlackAttachmentPayloadNotices(
    input.payload.attachmentNotices
  );
  let droppedCount = input.payload.attachmentDroppedCount ?? 0;

  for (const attachment of input.payload.attachments ?? []) {
    if (isTooLarge(attachment.sizeBytes)) {
      droppedCount += 1;
      notices.push("(image too large)");
      logSlackAttachmentSkipped({
        reason: "size",
        attachmentId: attachment.id,
        mimetype: attachment.mimetype,
        sizeBytes: attachment.sizeBytes,
      });
      continue;
    }

    try {
      const dataUrl = await fetchSlackAttachmentDataUrl({
        deps: input.deps,
        botToken: input.botToken,
        attachment,
      });
      contentParts.push({
        type: "file",
        mediaType: attachment.mimetype,
        url: dataUrl,
        filename: attachment.name,
      });
    } catch (error) {
      droppedCount += 1;
      if (error instanceof RangeError) {
        notices.push("(image too large)");
        logSlackAttachmentSkipped({
          reason: "size",
          attachmentId: attachment.id,
          mimetype: attachment.mimetype,
          sizeBytes: attachment.sizeBytes,
        });
      } else {
        notices.push("(couldn't load attached image)");
        logSlackAttachmentSkipped({
          reason: "fetch_failed",
          attachmentId: attachment.id,
          mimetype: attachment.mimetype,
          sizeBytes: attachment.sizeBytes,
          error,
        });
      }
    }
  }

  return {
    contentParts,
    notices,
    attachedCount: contentParts.length,
    droppedCount,
  };
}

export function prepareSlackRepoAgentAttachments(
  payload: SlackEventTaskPayload
): PreparedSlackRepoAgentAttachments {
  const files: PreparedSlackRepoAgentAttachments["files"] = [];
  const notices = buildSlackAttachmentPayloadNotices(payload.attachmentNotices);
  let droppedCount = payload.attachmentDroppedCount ?? 0;

  for (const attachment of payload.attachments ?? []) {
    if (isTooLarge(attachment.sizeBytes)) {
      droppedCount += 1;
      notices.push("(image too large)");
      logSlackAttachmentSkipped({
        reason: "size",
        attachmentId: attachment.id,
        mimetype: attachment.mimetype,
        sizeBytes: attachment.sizeBytes,
      });
      continue;
    }
    files.push(attachment);
  }

  return {
    files,
    notices,
    attachedCount: files.length,
    droppedCount,
  };
}

export function buildSlackRepoAgentPrompt(input: {
  text: string;
  attachments: PreparedSlackRepoAgentAttachments;
}) {
  const baseText =
    input.text ||
    (input.attachments.attachedCount > 0
      ? "Please inspect the attached Slack image and address what it shows in this repository."
      : "");
  return appendSlackAttachmentNotices(baseText, input.attachments.notices);
}

export function buildSlackUserMessage(input: {
  text: string;
  attachments: PreparedSlackAttachments;
}): { agent: RunChatAgentMessage; persistedText: string } {
  const hasTextOrAttachedImage =
    Boolean(input.text) || input.attachments.contentParts.length > 0;
  const baseText = hasTextOrAttachedImage
    ? input.text || "Please analyze the attached image."
    : "";
  const textWithNotices = appendSlackAttachmentNotices(
    baseText,
    input.attachments.notices
  );
  const content: RunChatAgentMessage["content"] =
    input.attachments.contentParts.length > 0
      ? [
          { type: "text", text: textWithNotices },
          ...input.attachments.contentParts,
        ]
      : textWithNotices;

  return {
    agent: { role: "user", content },
    persistedText: textWithNotices,
  };
}
