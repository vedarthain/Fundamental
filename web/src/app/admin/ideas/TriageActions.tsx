"use client";

/**
 * Inline triage controls for each idea on /admin/ideas.
 *
 *   - "Mark handled" / "Mark unhandled" toggle
 *   - Notes textarea — saves on blur
 *
 * Both call /api/admin/ideas/:id (PATCH).  The admin page is already
 * cookie-gated, so the API trusts that cookie (validated server-side
 * via the same hash check).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function TriageActions({
  id, handled, notes,
}: { id: number; handled: boolean; notes: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [notesDraft, setNotesDraft] = useState(notes || "");
  const [saving, setSaving] = useState(false);

  const patch = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/ideas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t hairline flex items-start gap-3 flex-wrap">
      <button
        type="button"
        onClick={() => patch({ handled: !handled })}
        disabled={saving}
        className="text-[11.5px] px-2.5 py-1 rounded-md border font-medium transition-colors disabled:opacity-60"
        style={{
          borderColor: "var(--color-border-default)",
          backgroundColor: handled ? "var(--color-paper)" : "var(--color-card)",
          color: "var(--color-ink)",
        }}
      >
        {handled ? "Mark unhandled" : "Mark handled"}
      </button>

      <textarea
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        onBlur={() => {
          if (notesDraft.trim() !== (notes || "").trim()) {
            patch({ notes: notesDraft.trim() || null });
          }
        }}
        placeholder="Internal notes (saved on blur)…"
        rows={1}
        maxLength={1000}
        className="flex-1 min-w-[200px] px-2 py-1 rounded border text-[11.5px] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-300)] resize-y"
        style={{
          borderColor: "var(--color-border-default)",
          backgroundColor: "var(--color-card)",
        }}
      />
    </div>
  );
}
