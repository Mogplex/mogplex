import { resolveSandboxPath } from "@/lib/repo-settings";

export const BROWSER_HARNESS_ATTACHMENT_MAX_COUNT = 5;
export const BROWSER_HARNESS_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 5_600_000;
const ATTACHMENT_DIR = ".mogplex/chat-attachments";
const GITIGNORE_FILENAME = ".mogplex/.gitignore";

export type BrowserHarnessAttachment = {
  name: string;
  mediaType: string;
  dataUrl: string;
};

export type BrowserAttachmentWritableSandbox = {
  readFile: (input: { path: string }) => Promise<unknown>;
  writeFiles: (
    files: Array<{ path: string; content: Buffer }>
  ) => Promise<void>;
};

function normalizeString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeBrowserHarnessAttachments(
  value: unknown
): BrowserHarnessAttachment[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > BROWSER_HARNESS_ATTACHMENT_MAX_COUNT) {
    throw new Error(
      `Harness chat supports up to ${BROWSER_HARNESS_ATTACHMENT_MAX_COUNT} file attachments.`
    );
  }

  const normalized = value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid harness chat attachment.");
    }
    const record = entry as Record<string, unknown>;
    const name = normalizeString(record.name);
    const mediaType = normalizeString(record.mediaType);
    const dataUrl = normalizeString(record.dataUrl);
    if (!name || !mediaType || !dataUrl) {
      throw new Error("Invalid harness chat attachment.");
    }
    if (!dataUrl.toLowerCase().startsWith("data:")) {
      throw new Error("Harness chat attachments must use a data URL.");
    }
    if (dataUrl.length > MAX_DATA_URL_CHARS) {
      throw new Error("Harness chat attachment exceeds the size limit.");
    }
    return { name, mediaType, dataUrl };
  });

  return normalized.length > 0 ? normalized : null;
}

export function readBrowserHarnessAttachments(
  value: unknown
):
  | { ok: true; value: BrowserHarnessAttachment[] | null }
  | { ok: false; error: string } {
  try {
    return { ok: true, value: normalizeBrowserHarnessAttachments(value) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Invalid harness chat attachments.",
    };
  }
}

function decodeAttachment(attachment: BrowserHarnessAttachment) {
  const commaIndex = attachment.dataUrl.indexOf(",");
  const header = attachment.dataUrl.slice(0, commaIndex);
  const payload = attachment.dataUrl.slice(commaIndex + 1).replace(/\s/g, "");
  const headerParts = header.slice(5).split(";");
  if (
    commaIndex < 0 ||
    headerParts[0]?.toLowerCase() !== attachment.mediaType.toLowerCase() ||
    headerParts.at(-1)?.toLowerCase() !== "base64" ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
  ) {
    throw new Error("Invalid harness chat attachment data URL.");
  }
  const content = Buffer.from(payload, "base64");
  if (content.byteLength > BROWSER_HARNESS_ATTACHMENT_MAX_BYTES) {
    throw new Error("Harness chat attachment exceeds the size limit.");
  }
  return content;
}

function sanitizeFilename(name: string, index: number) {
  const collapsed = name
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[-_.]+/, "")
    .slice(0, 100);
  return `${String(index + 1).padStart(2, "0")}-${collapsed || "attachment"}`;
}

async function ensureIgnored(
  sandbox: BrowserAttachmentWritableSandbox,
  rootDirectory: string | null | undefined
) {
  const path = resolveSandboxPath(rootDirectory, GITIGNORE_FILENAME);
  try {
    if (await sandbox.readFile({ path })) return;
  } catch {
    // Missing is expected on the first Mogplex-owned attachment write.
  }
  await sandbox.writeFiles([{ path, content: Buffer.from("*\n") }]);
}

export async function materializeBrowserAttachmentsForHarness(input: {
  sandbox: BrowserAttachmentWritableSandbox;
  rootDirectory?: string | null;
  attachments: BrowserHarnessAttachment[] | null;
}) {
  if (!input.attachments?.length) {
    return { promptSection: null, writtenFiles: [] };
  }

  await ensureIgnored(input.sandbox, input.rootDirectory);
  const writtenFiles: Array<{
    path: string;
    mediaType: string;
    sizeBytes: number;
  }> = [];

  for (const [index, attachment] of input.attachments.entries()) {
    const content = decodeAttachment(attachment);
    const relativePath = `${ATTACHMENT_DIR}/${sanitizeFilename(
      attachment.name,
      index
    )}`;
    await input.sandbox.writeFiles([
      {
        path: resolveSandboxPath(input.rootDirectory, relativePath),
        content,
      },
    ]);
    writtenFiles.push({
      path: relativePath,
      mediaType: attachment.mediaType,
      sizeBytes: content.byteLength,
    });
  }

  const promptSection = [
    "<chat_attachments>",
    "The user attached files. I saved them in the sandbox workspace:",
    ...writtenFiles.map(
      (file) => `- ${file.path} (${file.mediaType}, ${file.sizeBytes} bytes)`
    ),
    "Inspect these files when they are relevant before editing or replying.",
    "</chat_attachments>",
  ].join("\n");

  return { promptSection, writtenFiles };
}
