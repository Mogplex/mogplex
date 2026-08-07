export function LoadingSummary() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading observability summary"
    >
      <section className="border-border overflow-hidden rounded-md border">
        <div className="border-border flex items-center justify-between gap-4 border-b p-4">
          <div className="space-y-2">
            <div className="bg-secondary h-4 w-36 animate-pulse rounded" />
            <div className="bg-secondary h-3 w-56 animate-pulse rounded" />
          </div>
          <div className="bg-secondary h-8 w-24 animate-pulse rounded" />
        </div>
        <div className="bg-border grid gap-px sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="bg-secondary/40 h-20 animate-pulse" />
          ))}
        </div>
      </section>
      <div className="border-border bg-border grid gap-px overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="bg-secondary/40 h-20 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
