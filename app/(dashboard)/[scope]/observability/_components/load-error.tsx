import { Button } from "@/components/ui/button"

export function LoadError({ subject, onRetry }: { subject: string; onRetry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-4 text-sm">
    <p>{subject} could not be loaded. Missing data is not a healthy or zero-usage result.</p>
    <Button variant="outline" onClick={onRetry}>Try again</Button>
  </div>
}
