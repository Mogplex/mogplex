import type { UIMessage } from "ai";

export type ControlArtifact = {
  id: string;
  title: string;
  description: string;
  kind: "document" | "file";
  body?: string;
  file?: {
    filename?: string;
    mediaType: string;
    url: string;
  };
};

function textLooksLikeArtifact(text: string) {
  const trimmed = text.trim();
  return (
    trimmed.length > 240 ||
    /^#{1,3}\s+/m.test(trimmed) ||
    /\n\|.+\|\n\|[-:\s|]+\|/m.test(trimmed) ||
    trimmed.includes("```") ||
    /^[-*]\s+\[[ x]\]/m.test(trimmed)
  );
}

function artifactTitle(text: string, fallback: string) {
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 80);
  const firstLine = text.trim().split("\n").find(Boolean);
  return (firstLine || fallback).slice(0, 80);
}

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
        fallbackTitle: `Artifact ${artifacts.length + 1}`,
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
  fallbackTitle: string;
}): ControlArtifact | null {
  const { part, idPrefix, partIndex, fallbackTitle } = input;
  if (!part || typeof part !== "object" || !("type" in part)) return null;

  if (part.type === "text" && "text" in part) {
    return collectTextArtifact({
      text: String(part.text ?? ""),
      id: `${idPrefix}-text-${partIndex}`,
      fallbackTitle,
    });
  }

  if (part.type !== "file" || !("url" in part) || !("mediaType" in part)) {
    return null;
  }

  return collectFileArtifact({
    part,
    id: `${idPrefix}-file-${partIndex}`,
  });
}

function collectTextArtifact(input: {
  text: string;
  id: string;
  fallbackTitle: string;
}): ControlArtifact | null {
  const { text, id, fallbackTitle } = input;
  if (!textLooksLikeArtifact(text)) return null;
  return {
    id,
    title: artifactTitle(text, fallbackTitle),
    description: "Assistant artifact",
    kind: "document",
    body: text,
  };
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
