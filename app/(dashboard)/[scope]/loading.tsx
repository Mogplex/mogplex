import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Please wait" className="min-h-full space-y-6 p-6">
      <div aria-hidden="true" className="space-y-3 motion-reduce:[&_*]:animate-none">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    </div>
  );
}
