"use client"

import {
  type ColumnDef,
  type SortingState,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Fragment, useMemo, useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  renderExpandedRow?: (row: TData) => React.ReactNode
  onRowClick?: (row: TData) => void
  onExpandedRowToggle?: (row: TData, expanded: boolean) => void
  getRowId?: (row: TData, index: number) => string
  expandedRowIds?: string[]
}

export function DataTable<TData, TValue>({
  columns,
  data,
  renderExpandedRow,
  onRowClick,
  onExpandedRowToggle,
  getRowId,
  expandedRowIds,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const controlledExpanded = useMemo<ExpandedState>(() => {
    if (!expandedRowIds) return {}
    return Object.fromEntries(expandedRowIds.map((rowId) => [rowId, true]))
  }, [expandedRowIds])
  const tableExpanded = expandedRowIds ? controlledExpanded : expanded

  // TanStack Table exposes imperative helpers that the React Compiler lint rule
  // flags as incompatible; this hook is intentionally used as designed here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, expanded: tableExpanded },
    onSortingChange: setSorting,
    onExpandedChange: expandedRowIds ? undefined : setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => !!renderExpandedRow,
    getRowId,
  })

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="border-border hover:bg-transparent">
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                className={cn(
                  "text-muted-foreground text-xs h-8 px-3",
                  header.column.getCanSort() && "cursor-pointer select-none"
                )}
                onClick={header.column.getToggleSortingHandler()}
              >
                <span className="flex items-center gap-1">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === "asc" && " \u2191"}
                  {header.column.getIsSorted() === "desc" && " \u2193"}
                </span>
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground text-xs">
              No results.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <TableRow
                data-state={row.getIsExpanded() ? "selected" : undefined}
                className={cn(
                  "border-border text-xs",
                  (renderExpandedRow || onRowClick) && "cursor-pointer"
                )}
                onClick={() => {
                  if (renderExpandedRow) {
                    const nextExpanded = !row.getIsExpanded()
                    if (expandedRowIds) {
                      onExpandedRowToggle?.(row.original, nextExpanded)
                    } else {
                      row.toggleExpanded()
                      onExpandedRowToggle?.(row.original, nextExpanded)
                    }
                  }
                  onRowClick?.(row.original)
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-3 py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
              {row.getIsExpanded() && renderExpandedRow && (
                <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
                  {/* TableCell defaults to whitespace-nowrap for compact data
                      cells; expanded detail content must wrap normally or long
                      values paint across the row. */}
                  <TableCell colSpan={columns.length} className="p-0 whitespace-normal">
                    {renderExpandedRow(row.original)}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))
        )}
      </TableBody>
    </Table>
  )
}
