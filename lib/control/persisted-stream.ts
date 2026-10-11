import {
  readUIMessageStream,
  isToolUIPart,
  createUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOnFinishCallback,
} from "ai";
import type { saveControlTranscript } from "./transcript-store";

export type ControlStreamCompletion = Parameters<
  UIMessageStreamOnFinishCallback<UIMessage>
>[0];

/** Server-side, identity-fenced checkpoints independent of the browser reader. */
export async function persistedControlStream(input: {
  stream: ReadableStream<UIMessageChunk>;
  messages: UIMessage[];
  expectedMessages: UIMessage[];
  messageId: string;
  continuationMessageId?: string;
  save: (
    messages: UIMessage[],
    expectedMessages: UIMessage[]
  ) => ReturnType<typeof saveControlTranscript>;
  onError: (error: unknown) => string;
  onComplete?: (event: ControlStreamCompletion) => Promise<void>;
}) {
  let expected = input.expectedMessages;
  let finished: ControlStreamCompletion | undefined;
  // Reserve identity before any chunks reach the browser. Its onFinish save
  // may otherwise insert a partial copy before our final checkpoint arrives.
  if (!input.continuationMessageId) {
    const reserved = await input.save(
      [{ id: input.messageId, role: "assistant", parts: [] }],
      []
    );
    expected = reserved.messages;
  }
  const checkpoint = async ({
    responseMessage,
  }: {
    responseMessage: UIMessage;
  }) => {
    if (!responseMessage.id || responseMessage.parts.length === 0) return;
    const previous = expected.filter(
      (message) => message.id === responseMessage.id
    );
    if (JSON.stringify(previous[0]) === JSON.stringify(responseMessage)) return;
    const result = await input.save([responseMessage], previous);
    expected = result.messages;
  };
  const persisted = createUIMessageStream({
    // A concurrently completed reply is context, not the message this run owns.
    originalMessages: input.continuationMessageId
      ? input.messages.filter(
          (message) =>
            message.id === input.continuationMessageId &&
            message.role === "assistant"
        )
      : [],
    generateId: () => input.messageId,
    execute: ({ writer }) => writer.merge(input.stream),
    onEnd: async (event) => {
      finished = event;
    },
    onError: input.onError,
  });
  const [stream, durable] = persisted.tee();
  // The server copy continues through abort/final chunks even if the UI leaves.
  // The route registers this promise with Next after() to preserve its lifetime.
  const completion = (async () => {
    let pending: UIMessage | undefined;
    let writing: Promise<void> | undefined;
    let saveFailure: Error | undefined;
    const scheduleCheckpoint = (message: UIMessage) => {
      pending = structuredClone(message);
      if (writing || saveFailure) return;
      // Coalesce deltas while a write is in flight. Each new delta supplies
      // work; there is no timer or polling loop and writes remain ordered.
      writing = (async () => {
        while (pending) {
          const responseMessage = pending;
          pending = undefined;
          await checkpoint({ responseMessage });
        }
      })()
        .catch((error) => {
          saveFailure =
            error instanceof Error
              ? error
              : new Error("Could not save progress.");
        })
        .finally(() => {
          writing = undefined;
          if (pending && !saveFailure) scheduleCheckpoint(pending);
        });
    };
    const savedBoundaries = new Set(
      input.messages.flatMap((message) =>
        message.parts
          .filter(isToolUIPart)
          .map((part) => `${part.toolCallId}:${part.state}`)
      )
    );
    try {
      for await (const message of readUIMessageStream({
        stream: durable,
        terminateOnError: true,
        message: structuredClone(
          input.continuationMessageId
            ? input.messages.find(
                (item) => item.id === input.continuationMessageId
              )
            : undefined
        ),
      })) {
        const part = message.parts.at(-1);
        const boundary =
          part && isToolUIPart(part) && part.state !== "input-streaming"
            ? `${part.toolCallId}:${part.state}`
            : part?.type === "text" && part.state === "done"
              ? `text:${message.parts.length}`
              : null;
        if (
          (part?.type === "text" && part.text.length > 0) ||
          (boundary && !savedBoundaries.has(boundary))
        ) {
          scheduleCheckpoint(message);
          if (boundary) savedBoundaries.add(boundary);
        }
      }
    } finally {
      while (writing) {
        const active = writing;
        await active;
        if (writing === active) writing = undefined;
      }
    }
    if (saveFailure) throw saveFailure;
    if (finished) {
      await checkpoint(finished);
      await input.onComplete?.(finished);
    }
  })();
  // Attach a handler immediately; after() also observes the original promise.
  void completion.catch(input.onError);
  return { stream, completion };
}
