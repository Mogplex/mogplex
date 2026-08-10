import { resolveSandboxPath } from "@/lib/repo-settings";

export const SLACK_IMAGE_ATTACHMENT_MAX_BYTES = 5_000_000;
export const SLACK_IMAGE_ATTACHMENT_FETCH_TIMEOUT_MS = 5_000;
export const SLACK_IMAGE_ATTACHMENT_MAX_COUNT = 4;
export const SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY =
  "slack_image_attachments";

export const SLACK_IMAGE_ATTACHMENT_MIMETYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SlackImageAttachmentMimeType =
  (typeof SLACK_IMAGE_ATTACHMENT_MIMETYPES)[number];

export type SlackRunImageAttachment = {
  id: string;
  mimetype: SlackImageAttachmentMimeType;
  urlPrivateDownload: string;
  name?: string;
  sizeBytes?: number;
};

export type SlackRunImageAttachmentsMetadata = {
  teamId: string;
  files: SlackRunImageAttachment[];
  droppedCount?: number;
};

const SUPPORTED_MIMETYPES = new Set<string>(SLACK_IMAGE_ATTACHMENT_MIMETYPES);
const SLACK_FILE_DOWNLOAD_HOSTNAMES = new Set(["files.slack.com", "slack.com"]);
const SLACK_FILE_DOWNLOAD_PATH_PREFIX = "/files-pri/";

function normalizeString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeSlackFileDownloadUrl(value: unknown) {
  const raw = normalizeString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !SLACK_FILE_DOWNLOAD_HOSTNAMES.has(url.hostname) ||
      !url.pathname.startsWith(SLACK_FILE_DOWNLOAD_PATH_PREFIX) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSizeBytes(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normalizeDroppedCount(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 100
    ? value
    : undefined;
}

export function isSlackImageAttachmentMimetype(
  value: unknown
): value is SlackImageAttachmentMimeType {
  return typeof value === "string" && SUPPORTED_MIMETYPES.has(value);
}

function normalizeSlackRunImageAttachment(
  value: unknown
): SlackRunImageAttachment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const urlPrivateDownload = normalizeSlackFileDownloadUrl(
    record.urlPrivateDownload
  );
  const mimetype = record.mimetype;
  if (!id || !urlPrivateDownload || !isSlackImageAttachmentMimetype(mimetype)) {
    return null;
  }

  const name = normalizeString(record.name);
  const sizeBytes = normalizeSizeBytes(record.sizeBytes);
  return {
    id,
    mimetype,
    urlPrivateDownload,
    ...(name ? { name } : {}),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
  };
}

export function normalizeSlackRunImageAttachmentsMetadata(
  value: unknown
): SlackRunImageAttachmentsMetadata | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const teamId = normalizeString(record.teamId);
  if (!teamId || !Array.isArray(record.files)) return null;

  const files = record.files
    .map(normalizeSlackRunImageAttachment)
    .filter(Boolean)
    .slice(0, SLACK_IMAGE_ATTACHMENT_MAX_COUNT) as SlackRunImageAttachment[];
  if (files.length === 0) {
    if (record.files.length > 0) {
      console.warn(
        "[slack-run-attachments] dropped all Slack image attachments metadata",
        { fileCount: record.files.length }
      );
    }
    return null;
  }

  const droppedCount = normalizeDroppedCount(record.droppedCount);
  return {
    teamId,
    files,
    ...(droppedCount === undefined ? {} : { droppedCount }),
  };
}

export type SlackAttachmentWritableSandbox = {
  readFile: (input: { path: string }) => Promise<unknown>;
  writeFiles: (
    files: Array<{ path: string; content: Buffer }>
  ) => Promise<void>;
};

export type SlackAttachmentMaterialization = {
  promptSection: string | null;
  writtenFiles: Array<{
    slackFileId: string;
    path: string;
    mimetype: SlackRunImageAttachment["mimetype"];
    sizeBytes: number;
  }>;
  droppedCount: number;
  unavailableCount: number;
};

export type SlackAttachmentMaterializationDeps = {
  getSlackBotToken: (teamId: string) => Promise<string | null>;
  fetchSlackAttachment: (input: {
    botToken: string;
    url: string;
    signal: AbortSignal;
  }) => Promise<Response>;
};

const MOGPLEX_GITIGNORE_FILENAME = ".mogplex/.gitignore";
const MOGPLEX_GITIGNORE_CONTENT = "*\n";
const SLACK_ATTACHMENT_DIR = ".mogplex/slack-attachments";

function slackImageExtension(mimetype: SlackRunImageAttachment["mimetype"]) {
  if (mimetype === "image/jpeg") return "jpg";
  return mimetype.split("/")[1] ?? "img";
}

function sanitizeSlackImageFilename(
  attachment: SlackRunImageAttachment,
  index: number
) {
  const extension = slackImageExtension(attachment.mimetype);
  const raw = attachment.name?.trim() || `${attachment.id}.${extension}`;
  const collapsed = raw
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.*/, "")
    .slice(0, 80);
  const base = collapsed || `image.${extension}`;
  const withExtension = /\.[A-Za-z0-9]{2,5}$/.test(base)
    ? base
    : `${base}.${extension}`;
  return `${String(index + 1).padStart(2, "0")}-${withExtension}`;
}

function isSlackAttachmentTooLarge(sizeBytes: number | undefined) {
  return (
    typeof sizeBytes === "number" &&
    Number.isFinite(sizeBytes) &&
    sizeBytes > SLACK_IMAGE_ATTACHMENT_MAX_BYTES
  );
}

async function ensureMogplexGitignoreForHarnessAttachments(
  sandbox: SlackAttachmentWritableSandbox,
  rootDirectory: string | null | undefined
) {
  const path = resolveSandboxPath(rootDirectory, MOGPLEX_GITIGNORE_FILENAME);
  try {
    const existing = await sandbox.readFile({ path });
    if (existing) return;
  } catch {
    // Treat missing or unreadable as absent so generated attachment files stay
    // ignored even when this is the first Mogplex-owned write in the sandbox.
  }
  await sandbox.writeFiles([
    { path, content: Buffer.from(MOGPLEX_GITIGNORE_CONTENT) },
  ]);
}

function responseContentLength(response: Response): number | undefined {
  const header = response.headers.get("content-length");
  if (!header) return undefined;
  const parsed = Number(header);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fetchSlackAttachmentBytes(input: {
  deps: Pick<SlackAttachmentMaterializationDeps, "fetchSlackAttachment">;
  botToken: string;
  attachment: SlackRunImageAttachment;
}): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SLACK_IMAGE_ATTACHMENT_FETCH_TIMEOUT_MS
  );
  try {
    const response = await input.deps.fetchSlackAttachment({
      botToken: input.botToken,
      url: input.attachment.urlPrivateDownload,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Slack file fetch failed with ${response.status}`);
    }
    const contentLength = responseContentLength(response);
    if (isSlackAttachmentTooLarge(contentLength)) {
      throw new RangeError("Slack file is too large");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > SLACK_IMAGE_ATTACHMENT_MAX_BYTES) {
      throw new RangeError("Slack file is too large");
    }
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSlackAttachmentPromptSection(
  result: SlackAttachmentMaterialization
) {
  const lines = ["<slack_attachments>"];
  if (result.writtenFiles.length > 0) {
    lines.push(
      "The Slack message included image attachments. I saved the files in the sandbox workspace:",
      ...result.writtenFiles.map(
        (file) => `- ${file.path} (${file.mimetype}, ${file.sizeBytes} bytes)`
      ),
      "Inspect these files when they are relevant before editing or replying."
    );
  } else {
    lines.push(
      "The Slack message included image attachments, but Mogplex could not save any of them into the sandbox."
    );
  }
  if (result.droppedCount > 0) {
    lines.push(
      `${result.droppedCount} Slack image attachment(s) were dropped.`
    );
  }
  if (result.unavailableCount > 0) {
    lines.push(
      `${result.unavailableCount} Slack image attachment(s) could not be downloaded.`
    );
  }
  lines.push("</slack_attachments>");
  return lines.join("\n");
}

function logSlackHarnessAttachmentSkipped(input: {
  reason: "size";
  attachmentId: string;
  mimetype: SlackRunImageAttachment["mimetype"];
  sizeBytes?: number;
}) {
  console.warn("[harness] skipped Slack image", input);
}

function summarizeSlackAttachmentError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

export function appendSlackAttachmentPromptSection(
  prompt: string,
  section: string | null
) {
  return section ? `${prompt}\n\n${section}` : prompt;
}

export async function materializeSlackImageAttachmentsForHarness(input: {
  deps: SlackAttachmentMaterializationDeps;
  sandbox: SlackAttachmentWritableSandbox;
  rootDirectory?: string | null;
  attachments: SlackRunImageAttachmentsMetadata | null;
}) {
  const attachments = input.attachments;
  if (!attachments) {
    return {
      promptSection: null,
      writtenFiles: [],
      droppedCount: 0,
      unavailableCount: 0,
    } satisfies SlackAttachmentMaterialization;
  }

  let botToken: string | null;
  try {
    botToken = await input.deps.getSlackBotToken(attachments.teamId);
  } catch (error) {
    console.warn("[harness] failed to load Slack bot token for attachments", {
      teamId: attachments.teamId,
      error: summarizeSlackAttachmentError(error),
    });
    botToken = null;
  }
  let droppedCount = attachments.droppedCount ?? 0;
  let unavailableCount = 0;
  const writtenFiles: SlackAttachmentMaterialization["writtenFiles"] = [];

  if (!botToken) {
    return {
      promptSection: buildSlackAttachmentPromptSection({
        promptSection: null,
        writtenFiles: [],
        droppedCount,
        unavailableCount: attachments.files.length,
      }),
      writtenFiles,
      droppedCount,
      unavailableCount: attachments.files.length,
    };
  }

  await ensureMogplexGitignoreForHarnessAttachments(
    input.sandbox,
    input.rootDirectory
  );

  for (const [index, attachment] of attachments.files.entries()) {
    if (isSlackAttachmentTooLarge(attachment.sizeBytes)) {
      droppedCount += 1;
      logSlackHarnessAttachmentSkipped({
        reason: "size",
        attachmentId: attachment.id,
        mimetype: attachment.mimetype,
        sizeBytes: attachment.sizeBytes,
      });
      continue;
    }

    try {
      const bytes = await fetchSlackAttachmentBytes({
        deps: input.deps,
        botToken,
        attachment,
      });
      const relativePath = `${SLACK_ATTACHMENT_DIR}/${sanitizeSlackImageFilename(
        attachment,
        index
      )}`;
      await input.sandbox.writeFiles([
        {
          path: resolveSandboxPath(input.rootDirectory, relativePath),
          content: bytes,
        },
      ]);
      writtenFiles.push({
        slackFileId: attachment.id,
        path: relativePath,
        mimetype: attachment.mimetype,
        sizeBytes: bytes.byteLength,
      });
    } catch (error) {
      if (error instanceof RangeError) {
        droppedCount += 1;
        logSlackHarnessAttachmentSkipped({
          reason: "size",
          attachmentId: attachment.id,
          mimetype: attachment.mimetype,
          sizeBytes: attachment.sizeBytes,
        });
      } else {
        unavailableCount += 1;
        console.warn("[harness] failed to materialize Slack image", {
          attachmentId: attachment.id,
          mimetype: attachment.mimetype,
          error,
        });
      }
    }
  }

  const result: SlackAttachmentMaterialization = {
    promptSection: null,
    writtenFiles,
    droppedCount,
    unavailableCount,
  };
  result.promptSection = buildSlackAttachmentPromptSection(result);
  return result;
}
