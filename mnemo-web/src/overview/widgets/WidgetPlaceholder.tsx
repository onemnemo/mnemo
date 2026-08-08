import { Skeleton } from "@/components/ui/skeleton"

/**
 * The body every widget renders until its own is built.
 *
 * A skeleton rather than a label, because that is the state these widgets are genuinely in: the
 * board, its chrome and its layout are real, and nothing has fetched anything yet. It is also the
 * shape the finished widgets need anyway, since each of them renders a skeleton while its query is
 * pending instead of painting zeroes into a "has data" layout.
 */
export function WidgetPlaceholder() {
  return (
    <div className="flex h-full flex-col gap-2 pt-1">
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-3 w-3/5" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  )
}
