function LoadingCard() {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="h-4 w-24 animate-pulse rounded bg-secondary" />
        <div className="mt-2 h-3 w-56 animate-pulse rounded bg-secondary" />
      </div>
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-20 animate-pulse rounded bg-secondary" />
                <div className="h-3 w-full animate-pulse rounded bg-secondary" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-secondary" />
              </div>
              <div className="h-6 w-24 animate-pulse rounded-full bg-secondary" />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-secondary" />
                <div className="h-3 w-full animate-pulse rounded bg-secondary" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-secondary" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-secondary" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-full space-y-4 p-3 md:space-y-6 md:p-6">
      <div>
        <div className="h-8 w-28 animate-pulse rounded bg-secondary" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-secondary" />
      </div>
      <LoadingCard />
      <LoadingCard />
      <LoadingCard />
    </div>
  )
}
