import type { UIMessage } from "ai";

export type ControlArtifact = {
  id: string;
  title: string;
  description: string;
  kind: "file";
  file?: {
    filename?: string;
    mediaType: string;
    url: string;
  };
};

export function collectControlArtifacts(
  messages: UIMessage[]
): ControlArtifact[] {
  const artifacts: ControlArtifact[] = [];

  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== "assistant" || !Array.isArray(message.parts)) {
      continue;
    }

    for (const [partIndex, part] of message.parts.entries()) {
      const artifact = collectArtifactFromPart({
        part,
        idPrefix: String(message.id ?? messageIndex),
        partIndex,
      });
      if (artifact) artifacts.push(artifact);
    }
  }

  return artifacts;
}

function collectArtifactFromPart(input: {
  part: UIMessage["parts"][number];
  idPrefix: string;
  partIndex: number;
}): ControlArtifact | null {
  const { part, idPrefix, partIndex } = input;
  if (!part || typeof part !== "object" || !("type" in part)) return null;

  if (part.type !== "file" || !("url" in part) || !("mediaType" in part)) {
    return null;
  }

  return collectFileArtifact({
    part,
    id: `${idPrefix}-file-${partIndex}`,
  });
}

function collectFileArtifact(input: {
  part: Extract<UIMessage["parts"][number], { type: "file" }>;
  id: string;
}): ControlArtifact {
  const { part, id } = input;
  const filename = "filename" in part ? String(part.filename ?? "") : "";
  const mediaType = String(part.mediaType);
  return {
    id,
    title: filename || mediaType,
    description: mediaType,
    kind: "file",
    file: {
      filename: filename || undefined,
      mediaType,
      url: String(part.url),
    },
  };
}
