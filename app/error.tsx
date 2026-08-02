"use client"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-6">
      <div className="max-w-md w-full space-y-4 text-center">
        <div className="text-sm text-muted-foreground font-mono">Something went wrong</div>
        <div className="text-xs text-muted-foreground/70 break-all font-mono">
          {error.message || "An unexpected error occurred"}
        </div>
        {error.digest && (
          <div className="text-[10px] text-muted-foreground/50 font-mono">digest: {error.digest}</div>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 text-xs font-mono border border-border rounded hover:bg-secondary transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
