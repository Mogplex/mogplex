"use client";

export function ControlErrorBanner({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return <div className="mx-auto w-full max-w-[67rem] px-4 py-2 sm:px-6"><div role="alert" className="border-accent-amber/30 bg-accent-amber/5 text-accent-amber rounded border px-3 py-2 text-xs">{message}{onRetry && <button type="button" onClick={onRetry} className="ml-3 underline underline-offset-2">Retry</button>}</div></div>;
}

export function ControlConversationLoading() {
  return <div role="status" aria-label="Loading conversation" className="mx-auto w-full max-w-[67rem] flex-1 space-y-6 px-6 py-8"><span className="sr-only">Loading conversation</span><div className="bg-ink-800 h-4 w-1/3 animate-pulse rounded" /><div className="bg-ink-900 h-20 w-3/4 animate-pulse rounded-xl" /><div className="bg-ink-900 ml-auto h-16 w-1/2 animate-pulse rounded-xl" /><div className="bg-ink-900 h-24 w-3/4 animate-pulse rounded-xl" /></div>;
}
