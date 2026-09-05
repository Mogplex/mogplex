import {
  consumeStream,
  createUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { saveControlTranscript } from "./transcript-store";

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
  onComplete?: () => Promise<void>;
}) {
  let expected = input.expectedMessages;
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
    const result = await input.save(
      [responseMessage],
      expected.filter((message) => message.id === responseMessage.id)
    );
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
    onStepFinish: checkpoint,
    onFinish: checkpoint,
    onError: input.onError,
  });
  const [stream, durable] = persisted.tee();
  // The server copy continues through abort/final chunks even if the UI leaves.
  // The route registers this promise with Next after() to preserve its lifetime.
  const completion = consumeStream({
    stream: durable,
    onError: (error) => {
      throw error;
    },
  }).then(input.onComplete);
  // Attach a handler immediately; after() also observes the original promise.
  void completion.catch(input.onError);
  return { stream, completion };
}
