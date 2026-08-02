"use client"

import { Button } from "@/components/ui/button"

export function PaginationControls({
  page,
  totalPages,
  total,
  limit,
  onChange,
}: {
  page: number
  totalPages: number
  total: number
  limit: number
  onChange: (page: number) => void
}) {
  if (total === 0) return null

  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-8 text-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Prev
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
