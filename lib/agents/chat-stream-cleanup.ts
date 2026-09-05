import type { ChatModelStreamHooks } from "./run-chat";

/** SDK errors can end a stream without onFinish; every terminal path releases tools. */
export function withChatStreamCleanup(
  hooks: ChatModelStreamHooks | undefined,
  cleanup: () => Promise<void>
): ChatModelStreamHooks {
  return {
    ...hooks,
    async onError(event) {
      try {
        await hooks?.onError?.(event);
      } finally {
        await cleanup();
      }
    },
    async onAbort(event) {
      try {
        await hooks?.onAbort?.(event);
      } finally {
        await cleanup();
      }
    },
    async onFinish(event) {
      try {
        await hooks?.onFinish?.(event);
      } finally {
        await cleanup();
      }
    },
  };
}
