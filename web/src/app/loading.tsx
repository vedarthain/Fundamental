export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-4 sm:py-5 animate-pulse">
      <div className="pb-2.5 mb-4 border-b hairline">
        <div className="h-2.5 w-24 rounded bg-[var(--color-border-default)] mb-1.5" />
        <div className="h-5 w-48 rounded bg-[var(--color-border-default)]" />
        <div className="h-3 w-72 max-w-full rounded bg-[var(--color-border-default)] mt-1.5 opacity-70" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="h-28 rounded-lg border hairline bg-[var(--color-card)]/60" />
        <div className="h-28 rounded-lg border hairline bg-[var(--color-card)]/60" />
        <div className="h-28 rounded-lg border hairline bg-[var(--color-card)]/60" />
      </div>
    </div>
  );
}
