export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-3 sm:px-5 py-4 space-y-5 animate-pulse" aria-busy="true" aria-label="Loading page">
      {/* Header Skeleton */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b hairline">
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-[var(--color-border-default)] opacity-60" />
          <div className="h-7 w-56 rounded bg-[var(--color-border-default)]" />
          <div className="h-3.5 w-80 max-w-full rounded bg-[var(--color-border-default)] opacity-50" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-24 rounded-lg bg-[var(--color-border-default)] opacity-40" />
          <div className="h-8 w-28 rounded-lg bg-[var(--color-border-default)] opacity-40" />
        </div>
      </div>

      {/* 4-Card Hero Metric Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border hairline bg-[var(--color-card)]/70 p-4 space-y-2.5">
            <div className="h-2.5 w-24 rounded bg-[var(--color-border-default)] opacity-60" />
            <div className="h-7 w-32 rounded bg-[var(--color-border-default)]" />
            <div className="h-2.5 w-40 max-w-full rounded bg-[var(--color-border-default)] opacity-40" />
          </div>
        ))}
      </div>

      {/* Filter / Controls Bar Skeleton */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border hairline bg-[var(--color-card)]/40 p-3">
        <div className="h-8 w-64 rounded-lg bg-[var(--color-border-default)] opacity-50" />
        <div className="flex items-center gap-2">
          <div className="h-8 w-20 rounded-lg bg-[var(--color-border-default)] opacity-40" />
          <div className="h-8 w-24 rounded-lg bg-[var(--color-border-default)] opacity-40" />
        </div>
      </div>

      {/* Main Table Skeleton */}
      <div className="rounded-xl border hairline bg-[var(--color-card)]/60 overflow-hidden shadow-2xs">
        <div className="p-3 border-b hairline flex items-center justify-between">
          <div className="h-4 w-36 rounded bg-[var(--color-border-default)] opacity-60" />
          <div className="h-3 w-20 rounded bg-[var(--color-border-default)] opacity-40" />
        </div>
        <div className="divide-y hairline">
          {/* Header Row */}
          <div className="grid grid-cols-6 gap-4 px-4 py-3 bg-[var(--color-card)]/90">
            <div className="h-3 w-24 rounded bg-[var(--color-border-default)] opacity-70" />
            <div className="h-3 w-20 rounded bg-[var(--color-border-default)] opacity-70" />
            <div className="h-3 w-16 rounded bg-[var(--color-border-default)] opacity-70 ml-auto" />
            <div className="h-3 w-16 rounded bg-[var(--color-border-default)] opacity-70 ml-auto" />
            <div className="h-3 w-20 rounded bg-[var(--color-border-default)] opacity-70 ml-auto" />
            <div className="h-3 w-24 rounded bg-[var(--color-border-default)] opacity-70 ml-auto" />
          </div>
          {/* Data Rows */}
          {[1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
            <div key={row} className="grid grid-cols-6 gap-4 px-4 py-3.5 items-center">
              <div className="space-y-1.5">
                <div className="h-3.5 w-28 rounded bg-[var(--color-border-default)] opacity-80" />
                <div className="h-2.5 w-36 rounded bg-[var(--color-border-default)] opacity-40" />
              </div>
              <div className="h-3 w-20 rounded bg-[var(--color-border-default)] opacity-50" />
              <div className="h-3.5 w-16 rounded bg-[var(--color-border-default)] opacity-70 ml-auto" />
              <div className="h-3.5 w-14 rounded bg-[var(--color-border-default)] opacity-70 ml-auto" />
              <div className="h-5 w-20 rounded-full bg-[var(--color-border-default)] opacity-50 ml-auto" />
              <div className="h-3.5 w-24 rounded bg-[var(--color-border-default)] opacity-60 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
