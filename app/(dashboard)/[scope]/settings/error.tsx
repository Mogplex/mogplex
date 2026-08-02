"use client"

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-full p-3 md:p-6">
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <div className="ui-section-title">Settings</div>
          <div className="ui-section-caption">
            The settings view could not be rendered.
          </div>
        </div>
        <div className="space-y-4 p-4">
          <div className="rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-300">
            {error.message || "An unexpected error occurred while loading Settings."}
          </div>
          {error.digest && (
            <div className="text-[11px] text-muted-foreground">
              digest: {error.digest}
            </div>
          )}
          <button
            onClick={reset}
            className="inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}
