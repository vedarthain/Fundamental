"use client";

/**
 * Inline triage controls for each idea on /admin/ideas.
 *
 *   - status dropdown (open / planned / building / shipped / wont_do)
 *   - public toggle (controls visibility on the public /feedback board)
 *   - response textarea (the public-facing admin reply)
 *   - notes textarea (internal only — never shown publicly)
 *   - "Mark handled" / "Mark unhandled" toggle
 *
 * Each field is saved independently (status, public, response, notes,
 * handled). Saves happen on change (dropdowns, toggles) or on blur
 * (textareas). The admin page is cookie-gated; this client component
 * just talks to PATCH /api/admin/ideas/:id.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Status = "open" | "planned" | "building" | "shipped" | "wont_do";

const STATUS_OPTIONS: { value: Status; label: string; color: string }[] = [
  { value: "open",     label: "Open",      color: "var(--color-muted)" },
  { value: "planned",  label: "Planned",   color: "#3a9290" },
  { value: "building", label: "Building",  color: "#c08e2c" },
  { value: "shipped",  label: "Shipped",   color: "#2e9a47" },
  { value: "wont_do",  label: "Won't do",  color: "var(--color-delta-down)" },
];

export function TriageActions({
  id, handled, notes, status, isPublic, response,
}: {
  id: number;
  handled: boolean;
  notes: string | null;
  status: string;
  isPublic: boolean;
  response: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [notesDraft, setNotesDraft] = useState(notes || "");
  const [responseDraft, setResponseDraft] = useState(response || "");
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
    <div className="mt-3 pt-3 border-t hairline space-y-2">
      {/* Row 1: status + public toggle + handled toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] muted-text">Status:</label>
        <select
          value={status}
          onChange={(e) => patch({ status: e.target.value })}
          disabled={saving}
          className="text-[11.5px] px-2 py-1 rounded border font-medium focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-300)]"
          style={{
            borderColor: "var(--color-border-default)",
            backgroundColor: "var(--color-card)",
            color: STATUS_OPTIONS.find((o) => o.value === status)?.color || "var(--color-ink)",
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <label className="text-[11.5px] inline-flex items-center gap-1.5 ml-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => patch({ is_public: e.target.checked })}
            disabled={saving}
            className="cursor-pointer"
          />
          <span className={isPublic ? "font-semibold" : "muted-text"}>
            {isPublic ? "Public" : "Private"}
          </span>
        </label>

        <button
          type="button"
          onClick={() => patch({ handled: !handled })}
          disabled={saving}
          className="text-[11.5px] px-2 py-1 rounded-md border font-medium transition-colors disabled:opacity-60 ml-auto"
          style={{
            borderColor: "var(--color-border-default)",
            backgroundColor: handled ? "var(--color-paper)" : "var(--color-card)",
            color: "var(--color-ink)",
          }}
        >
          {handled ? "Mark unhandled" : "Mark handled"}
        </button>
      </div>

      {/* Row 2: public response (only visible if isPublic to highlight relevance) */}
      <div>
        <label className="block text-[11px] muted-text mb-1">
          Public response {isPublic ? "" : <span className="opacity-60">(shown when this idea is public)</span>}
        </label>
        <textarea
          value={responseDraft}
          onChange={(e) => setResponseDraft(e.target.value)}
          onBlur={() => {
            if (responseDraft.trim() !== (response || "").trim()) {
              patch({ response: responseDraft.trim() || null });
            }
          }}
          placeholder="What you'd tell the user (and the public board). Saves on blur."
          rows={2}
          maxLength={2000}
          className="w-full px-2 py-1 rounded border text-[12px] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-300)] resize-y"
          style={{
            borderColor: "var(--color-border-default)",
            backgroundColor: "var(--color-card)",
          }}
        />
      </div>

      {/* Row 3: internal notes (never public) */}
      <div>
        <label className="block text-[11px] muted-text mb-1">
          Internal notes <span className="opacity-60">(never shown publicly)</span>
        </label>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => {
            if (notesDraft.trim() !== (notes || "").trim()) {
              patch({ notes: notesDraft.trim() || null });
            }
          }}
          placeholder="Triage notes for yourself. Saves on blur."
          rows={1}
          maxLength={1000}
          className="w-full px-2 py-1 rounded border text-[11.5px] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-300)] resize-y"
          style={{
            borderColor: "var(--color-border-default)",
            backgroundColor: "var(--color-paper)",
          }}
        />
      </div>
    </div>
  );
}
