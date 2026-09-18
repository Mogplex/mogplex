import type { ChatModelStreamHooks } from "./run-chat";

/** SDK errors can end a stream without onEnd; every terminal path releases tools. */
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
    async onEnd(event) {
      try {
        await hooks?.onEnd?.(event);
      } finally {
        await cleanup();
      }
    },
  };
}
