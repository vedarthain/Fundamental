"use client";

/**
 * BookmarkMenu — a small toolbar dropdown for saving & jumping between saved
 * positions on a scanner surface (Graph industries, Themes). Generic over the
 * bookmark shape: it only needs `{ id, label }`; callers own capture/restore.
 *
 * Behaviour: the trigger shows a bookmark icon + saved count. Opening reveals a
 * "save current view" row (prefilled with a suggested label) and the list of
 * saved spots — click a row to jump, hover for rename/delete. Closes on
 * click-outside or Escape.
 */
import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, Pencil, Plus, Trash2, X } from "lucide-react";

type Item = { id: string; label: string };

export function BookmarkMenu<T extends Item>({
  items,
  suggestLabel,
  onSave,
  onJump,
  onRemove,
  onRename,
  describe,
  title = "Bookmarks",
}: {
  items: T[];
  /** Label prefilled into the save field when the menu opens. */
  suggestLabel: () => string;
  onSave: (label: string) => void;
  onJump: (item: T) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
  /** Optional secondary line shown under each saved label. */
  describe?: (item: T) => string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Prefill the save field with a fresh suggestion each time the menu opens.
  useEffect(() => {
    if (open) {
      setDraft(suggestLabel());
      setEditingId(null);
    }
    // suggestLabel is recomputed per render; only re-run on open toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on click-outside / Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function saveDraft() {
    const label = draft.trim();
    if (!label) return;
    onSave(label);
    setDraft("");
  }

  function commitEdit() {
    if (editingId) {
      const label = editDraft.trim();
      if (label) onRename(editingId, label);
    }
    setEditingId(null);
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={open}
        title={title}
        className="inline-flex items-center gap-1 rounded-md border hairline px-2.5 py-1.5 text-[12px] font-medium hover:bg-[var(--color-paper)] transition-colors"
        style={open ? { background: "var(--color-accent-600)", color: "#fff" } : undefined}
      >
        <Bookmark size={13} fill={items.length > 0 ? "currentColor" : "none"} strokeWidth={2} />
        {items.length > 0 && <span className="tabular-nums">{items.length}</span>}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 w-72 rounded-lg border hairline bg-[var(--color-card)] shadow-lg p-2"
          role="menu"
        >
          {/* Save current view */}
          <div className="flex items-center gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveDraft();
              }}
              placeholder="Name this spot…"
              className="flex-1 rounded-md border hairline bg-transparent px-2 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent-600)]"
              aria-label="Bookmark name"
            />
            <button
              type="button"
              onClick={saveDraft}
              disabled={!draft.trim()}
              title="Save current view"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-white disabled:opacity-40 transition-colors"
              style={{ background: "var(--color-accent-600)" }}
            >
              <Plus size={13} strokeWidth={2.5} />
            </button>
          </div>

          {/* Saved list */}
          <div className="mt-2 max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-1 py-3 text-center text-[11px] muted-text">
                No saved spots yet. Name the current view and hit +.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {items.map((it) => (
                  <li key={it.id}>
                    {editingId === it.id ? (
                      <div className="flex items-center gap-1 px-1 py-1">
                        <input
                          autoFocus
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 rounded-md border hairline bg-transparent px-2 py-1 text-[12px] outline-none focus:border-[var(--color-accent-600)]"
                          aria-label="Rename bookmark"
                        />
                        <button
                          type="button"
                          onClick={commitEdit}
                          title="Save name"
                          className="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                        >
                          <Check size={14} strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          title="Cancel"
                          className="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                        >
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    ) : (
                      <div className="group flex items-center gap-1 rounded-md px-1 hover:bg-[var(--color-paper)]">
                        <button
                          type="button"
                          onClick={() => {
                            onJump(it);
                            setOpen(false);
                          }}
                          className="flex-1 min-w-0 py-1.5 text-left"
                          title="Jump to this spot"
                        >
                          <span className="block truncate text-[12px] font-medium">{it.label}</span>
                          {describe && (
                            <span className="block truncate text-[10.5px] muted-text">{describe(it)}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(it.id);
                            setEditDraft(it.label);
                          }}
                          title="Rename"
                          className="shrink-0 rounded p-1 text-[var(--color-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-ink)] transition-opacity"
                        >
                          <Pencil size={13} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(it.id)}
                          title="Delete"
                          className="shrink-0 rounded p-1 text-[var(--color-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-danger,#c0392b)] transition-opacity"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
