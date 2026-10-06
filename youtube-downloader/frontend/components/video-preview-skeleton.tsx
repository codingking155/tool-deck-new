import { Skeleton } from "@/components/ui/skeleton";

export function VideoPreviewSkeleton() {
  return (
    <div
      role="status"
      aria-label="Analyzing video"
      className="grid gap-6 rounded-2xl border bg-card p-4 shadow-[var(--shadow-soft)] sm:p-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
    >
      <Skeleton className="aspect-video w-full rounded-xl" />
      <div className="flex flex-col gap-3 py-1">
        <Skeleton className="h-6 w-11/12" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-1 h-4 w-1/3" />
        <div className="mt-auto space-y-3 pt-6">
          <div className="flex justify-between">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-8 w-36 rounded-xl" />
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
      <span className="sr-only">Analyzing video…</span>
    </div>
  );
}
