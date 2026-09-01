"use client";

/**
 * ScribblePad — a personal notebook hung off the top nav, next to the user
 * menu. Click the pencil chip, jot anything, hit Save; each save becomes a
 * date-stamped entry in a newest-first journal below. Entries are per-user
 * (server-persisted via /api/notes), so they follow you across devices.
 *
 * Entries can be edited in place (pencil) or deleted (✕). An edit preserves the
 * entry's created_at, so the note keeps its authored date + journal position —
 * we're fixing an old record's text, not re-dating it. Click-outside and Escape
 * close the panel (same pattern as UserMenu).
 */

import { useEffect, useRef, useState } from "react";

type Note = { id: number; body: string; created_at: string };

/** "21 Aug 2026" — the entry's date, the way Deb asked for it. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "14:32" — a light time hint so two notes on the same day still order. */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ScribblePad() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In-place edit state: the id of the note being edited + its working text.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Lazy-load on first open so the nav render stays cheap for users who never
  // touch the pad.
  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/notes", { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { notes: Note[] };
        if (alive) {
          setNotes(data.notes ?? []);
          setLoaded(true);
        }
      } catch {
        if (alive) setError("Couldn’t load notes.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, loaded]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape (but not while the textarea has focus mid-typing —
  // Escape there just blurs).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape cancels an in-progress edit first; only closes the pad otherwise.
      if (editingId != null) cancelEdit();
      else setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, editingId]);

  async function onSave() {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/notes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { note: Note };
      setNotes((prev) => [data.note, ...prev]);
      setDraft("");
    } catch {
      setError("Couldn’t save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(n: Note) {
    setEditingId(n.id);
    setEditDraft(n.body);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function onEditSave() {
    if (editingId == null) return;
    const body = editDraft.trim();
    if (!body || editSaving) return;
    setEditSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/notes", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, body }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { note: Note };
      // created_at is preserved server-side, so position/order don't shift.
      setNotes((prev) => prev.map((x) => (x.id === data.note.id ? data.note : x)));
      cancelEdit();
    } catch {
      setError("Couldn’t save edit. Try again.");
    } finally {
      setEditSaving(false);
    }
  }

  async function onDelete(id: number) {
    // Optimistic — drop it locally, roll back on failure.
    const prev = notes;
    setNotes((n) => n.filter((x) => x.id !== id));
    try {
      const r = await fetch(`/api/notes?id=${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      setNotes(prev);
      setError("Couldn’t delete. Try again.");
    }
  }

  // Cmd/Ctrl+Enter saves from the textarea.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void onSave();
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-8 h-8 rounded-full border transition-colors hover:bg-[var(--color-paper)]"
        style={{ borderColor: "var(--color-border-default)" }}
        title="Scribble pad — your dated notes"
      >
        <span aria-hidden className="text-[14px] leading-none">✎</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Scribble pad"
          className="absolute right-0 top-full mt-2 w-[320px] max-w-[92vw] rounded-md border hairline shadow-lg z-50 overflow-hidden"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          <div className="px-3.5 py-2.5 border-b hairline flex items-center justify-between">
            <span className="text-[12.5px] font-semibold">Scribble pad</span>
            <span className="text-[10.5px] muted-text">{notes.length} {notes.length === 1 ? "note" : "notes"}</span>
          </div>

          {/* Composer */}
          <div className="p-3 border-b hairline">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              maxLength={4000}
              placeholder="Jot something… (⌘/Ctrl+Enter to save)"
              className="w-full resize-y rounded-md border hairline bg-transparent px-2.5 py-2 text-[12.5px] leading-snug focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10.5px] muted-text">
                {error ?? (draft.trim() ? `${draft.trim().length} chars` : "Dated on save")}
              </span>
              <button
                type="button"
                onClick={onSave}
                disabled={!draft.trim() || saving}
                className="px-3 py-1 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {/* Journal */}
          <div className="max-h-[46vh] overflow-y-auto">
            {!loaded && !error && (
              <div className="px-3.5 py-4 text-[12px] muted-text">Loading…</div>
            )}
            {loaded && notes.length === 0 && (
              <div className="px-3.5 py-4 text-[12px] muted-text italic">
                Nothing yet. Your dated notes will appear here.
              </div>
            )}
            {notes.map((n) => (
              <div key={n.id} className="px-3.5 py-2.5 border-b hairline last:border-b-0 group">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10.5px] font-medium tabular-nums" style={{ color: "var(--color-accent-600)" }}>
                    {fmtDate(n.created_at)}
                    <span className="muted-text font-normal ml-1.5">{fmtTime(n.created_at)}</span>
                  </span>
                  {editingId !== n.id && (
                    <span className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => startEdit(n)}
                        className="text-[11px] muted-text hover:text-[var(--color-accent-600)]"
                        title="Edit this note"
                        aria-label="Edit note"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(n.id)}
                        className="text-[11px] muted-text hover:text-[var(--color-delta-down)]"
                        title="Delete this note"
                        aria-label="Delete note"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </div>
                {editingId === n.id ? (
                  <div className="mt-1">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          void onEditSave();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      rows={3}
                      maxLength={4000}
                      autoFocus
                      className="w-full resize-y rounded-md border hairline bg-transparent px-2.5 py-2 text-[12.5px] leading-snug focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
                    />
                    <div className="mt-1.5 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="px-2.5 py-1 rounded-md text-[12px] font-medium border hairline transition-colors hover:bg-[var(--color-paper)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={onEditSave}
                        disabled={!editDraft.trim() || editSaving}
                        className="px-3 py-1 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50"
                        style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
                      >
                        {editSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[12.5px] leading-snug whitespace-pre-wrap break-words">{n.body}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
