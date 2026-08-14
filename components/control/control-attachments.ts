export type ControlComposerFile = {
  id: string;
  type: "file";
  mediaType: string;
  filename?: string;
  url: string;
};

export const MAX_CONTROL_ATTACHMENT_COUNT = 5;
const MAX_CONTROL_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export function appendControlComposerFiles(
  current: ControlComposerFile[],
  incoming: ControlComposerFile[]
): ControlComposerFile[] {
  return [...current, ...incoming].slice(0, MAX_CONTROL_ATTACHMENT_COUNT);
}

export function consumeControlFileInput(
  input: Pick<HTMLInputElement, "files" | "value">
): File[] {
  const selectedFiles = Array.from(input.files ?? []);
  input.value = "";
  return selectedFiles;
}

export async function readControlComposerFiles(
  selectedFiles: File[],
  existingCount: number
): Promise<{ attachments: ControlComposerFile[]; error: string | null }> {
  const availableSlots = MAX_CONTROL_ATTACHMENT_COUNT - existingCount;
  if (availableSlots <= 0) {
    return {
      attachments: [],
      error: `Attach up to ${MAX_CONTROL_ATTACHMENT_COUNT} files.`,
    };
  }

  const filesToRead = selectedFiles.slice(0, availableSlots);
  const skippedForCount = selectedFiles.length - filesToRead.length;
  const acceptedFiles = filesToRead.filter(
    (file) => file.size <= MAX_CONTROL_ATTACHMENT_BYTES
  );
  const skippedForSize = filesToRead.length - acceptedFiles.length;

  const settled = await Promise.allSettled(
    acceptedFiles.map(
      (file) =>
        new Promise<ControlComposerFile>((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () =>
            resolve({
              id: crypto.randomUUID(),
              type: "file",
              mediaType: file.type || "application/octet-stream",
              filename: file.name,
              url: String(reader.result),
            })
          );
          reader.addEventListener("error", () =>
            reject(reader.error ?? new Error("Failed to read file"))
          );
          reader.readAsDataURL(file);
        })
    )
  );

  const attachments = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  const failedReads = settled.length - attachments.length;
  const errors: string[] = [];

  if (skippedForCount > 0) {
    errors.push(`Only ${MAX_CONTROL_ATTACHMENT_COUNT} files can be attached.`);
  }
  if (skippedForSize > 0) {
    errors.push("Some files are larger than the 4 MB attachment limit.");
  }
  if (failedReads > 0) {
    errors.push("Some files could not be read.");
  }

  return {
    attachments,
    error: errors.length > 0 ? errors.join(" ") : null,
  };
}
