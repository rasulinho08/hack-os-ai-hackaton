"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BookOpen,
  Plus,
  Trash2,
  X,
  GripVertical,
  ExternalLink,
  Pencil,
  Save,
  Info,
  Loader2,
} from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { useToast } from "@/contexts/ToastContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

interface Resource {
  id: number;
  event_id: number;
  section: string;
  label: string;
  description: string | null;
  url: string | null;
  sort_order: number;
}

interface DraftResource {
  tempId: string;
  section: string;
  label: string;
  description: string;
  url: string;
}

const DEFAULT_SECTIONS = [
  "API Keys",
  "Cloud Credits",
  "Datasets",
  "Documentation",
  "General",
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function AdminResourcesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading, primaryEvent } = useActiveEvent();
  const [rows, setRows] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<DraftResource>({
    tempId: uid(),
    section: "General",
    label: "",
    description: "",
    url: "",
  });

  // Edit inline
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editFields, setEditFields] = useState<Partial<Resource>>({});

  // Delete
  const [confirmDelete, setConfirmDelete] = useState<Resource | null>(null);

  const load = useCallback(
    async (eid: number) => {
      try {
        const data = await apiGet<Resource[]>(`/api/events/${eid}/resources`);
        setRows(Array.isArray(data) ? data : []);
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
        toast(t("resources.load_failed"), "error");
      } finally {
        setLoading(false);
      }
    },
    [toast, t],
  );

  useEffect(() => {
    if (eventLoading) {
      setLoading(true);
      return;
    }
    if (activeEventId == null) {
      setRows([]);
      setLoading(false);
      return;
    }
    void load(activeEventId);
  }, [activeEventId, eventLoading, load]);

  const addResource = async () => {
    if (!draft.label.trim() || activeEventId == null) return;
    setSaving(true);
    try {
      await apiPost(`/api/events/${activeEventId}/resources`, {
        section: draft.section,
        label: draft.label,
        description: draft.description || undefined,
        url: draft.url || undefined,
      });
      toast("Resource added", "success");
      setDraft({ tempId: uid(), section: "General", label: "", description: "", url: "" });
      setShowAdd(false);
      void load(activeEventId);
    } catch {
      toast("Failed to add resource", "error");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (r: Resource) => {
    setEditingId(r.id);
    setEditFields({
      section: r.section,
      label: r.label,
      description: r.description ?? "",
      url: r.url ?? "",
    });
  };

  const saveEdit = async () => {
    if (editingId == null || activeEventId == null) return;
    setSaving(true);
    try {
      await apiPatch(`/api/events/${activeEventId}/resources/${editingId}`, editFields);
      toast("Resource updated", "success");
      setEditingId(null);
      void load(activeEventId);
    } catch {
      toast("Failed to update resource", "error");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete || activeEventId == null) return;
    try {
      await apiDelete(`/api/events/${activeEventId}/resources/${confirmDelete.id}`);
      toast("Resource removed", "success");
      setConfirmDelete(null);
      void load(activeEventId);
    } catch {
      toast("Failed to delete resource", "error");
    }
  };

  // Group by section
  const sections = rows.reduce<Record<string, Resource[]>>((acc, r) => {
    const sec = r.section || "General";
    (acc[sec] ??= []).push(r);
    return acc;
  }, {});
  const sectionKeys = Object.keys(sections).sort();

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <BrandLoader />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">
            {t("resources.title") || "Resources"}
          </h1>
          <p className="mt-1 text-[15px] text-[var(--app-muted)]">
            {t("resources.subtitle") ||
              "Manage API keys, datasets, docs and sponsor links visible to hackers & mentors."}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#E1003C] px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#C00035]"
        >
          <Plus size={16} />
          {t("resources.add") || "Add Resource"}
        </button>
      </div>

      {!primaryEvent && (
        <div className="rounded-xl border border-white/10 bg-[var(--app-surface-2)] p-4 text-[15px] text-[var(--app-muted)]">
          <Info className="mb-2 inline" size={18} /> Select or create an event
          first.
        </div>
      )}

      {sectionKeys.length === 0 &&
        primaryEvent &&
        (loadFailed ? (
          <LoadFailure
            onRetry={() =>
              activeEventId != null ? void load(activeEventId) : undefined
            }
          />
        ) : (
          <div className="rounded-xl border border-white/5 bg-[var(--app-surface)] px-4 py-8 text-center text-[15px] text-[var(--app-muted-2)]">
            {t("resources.empty")}
          </div>
        ))}

      {sectionKeys.map((sec) => (
        <section
          key={sec}
          className="rounded-2xl border border-white/5 bg-[var(--app-surface)] p-5"
        >
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-white">
            <BookOpen size={15} className="text-[#E1003C]" />
            {sec}
            <span className="ml-auto text-[11px] font-normal text-[var(--app-muted-2)]">
              {sections[sec].length} item{sections[sec].length !== 1 ? "s" : ""}
            </span>
          </h2>
          <div className="space-y-2">
            {sections[sec].map((r) => {
              const isEditing = editingId === r.id;
              return (
                <div
                  key={r.id}
                  className="flex items-start gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-[13px]"
                >
                  <GripVertical
                    size={14}
                    className="mt-0.5 shrink-0 text-[#555]"
                  />
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          value={editFields.label ?? ""}
                          onChange={(e) =>
                            setEditFields((f) => ({ ...f, label: e.target.value }))
                          }
                          className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[13px] text-white outline-none focus:border-[#E1003C]/50"
                          placeholder="Label"
                        />
                        <input
                          value={editFields.description ?? ""}
                          onChange={(e) =>
                            setEditFields((f) => ({
                              ...f,
                              description: e.target.value,
                            }))
                          }
                          className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[13px] text-white outline-none focus:border-[#E1003C]/50"
                          placeholder="Description"
                        />
                        <input
                          value={editFields.url ?? ""}
                          onChange={(e) =>
                            setEditFields((f) => ({ ...f, url: e.target.value }))
                          }
                          className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[13px] text-white outline-none focus:border-[#E1003C]/50"
                          placeholder="URL"
                        />
                        <select
                          value={editFields.section ?? sec}
                          onChange={(e) =>
                            setEditFields((f) => ({
                              ...f,
                              section: e.target.value,
                            }))
                          }
                          className="h-8 rounded-lg border border-white/10 bg-[var(--app-surface-2)] px-3 text-[13px] text-white outline-none"
                        >
                          {DEFAULT_SECTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#E1003C] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#C00035] disabled:opacity-60"
                          >
                            {saving ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <Save size={10} />
                            )}
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-lg px-3 py-1.5 text-[11px] text-[var(--app-muted)] hover:bg-white/5"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="font-medium text-white">{r.label}</p>
                        {r.description && (
                          <p className="mt-0.5 text-[12px] text-[var(--app-muted)]">
                            {r.description}
                          </p>
                        )}
                        {r.url && (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[12px] text-[#E1003C] hover:underline"
                          >
                            <ExternalLink size={10} />
                            {r.url.length > 50
                              ? `${r.url.slice(0, 50)}…`
                              : r.url}
                          </a>
                        )}
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => startEdit(r)}
                        className="rounded-lg p-1.5 text-[var(--app-muted)] transition-colors hover:bg-white/5 hover:text-white"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(r)}
                        className="rounded-lg p-1.5 text-[var(--app-muted)] transition-colors hover:bg-[#FF3B30]/10 hover:text-[var(--app-danger)]"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Add resource modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[var(--app-surface)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Add Resource</h3>
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-lg p-2 text-[var(--app-muted-2)] transition-colors hover:bg-white/5 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[var(--app-muted)]">
                  Section
                </label>
                <select
                  value={draft.section}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, section: e.target.value }))
                  }
                  className="h-10 w-full rounded-xl border border-white/10 bg-[var(--app-surface-2)] px-3 text-[15px] text-white outline-none"
                >
                  {DEFAULT_SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[var(--app-muted)]">
                  Label *
                </label>
                <input
                  value={draft.label}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, label: e.target.value }))
                  }
                  placeholder="e.g. OpenAI API Key"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[15px] text-white outline-none placeholder:text-[var(--app-muted-2)] focus:border-[#E1003C]/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[var(--app-muted)]">
                  Description
                </label>
                <input
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                  placeholder="e.g. GPT-4o + Whisper access"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[15px] text-white outline-none placeholder:text-[var(--app-muted-2)] focus:border-[#E1003C]/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[var(--app-muted)]">
                  URL
                </label>
                <input
                  value={draft.url}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, url: e.target.value }))
                  }
                  placeholder="https://…"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[15px] text-white outline-none placeholder:text-[var(--app-muted-2)] focus:border-[#E1003C]/50"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-xl px-4 py-2 text-[15px] font-medium text-[var(--app-muted)] transition-colors hover:bg-white/5 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={addResource}
                disabled={saving || !draft.label.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#E1003C] px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#C00035] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Add Resource"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDelete}
        title="Delete Resource"
        message={
          confirmDelete
            ? `Delete "${confirmDelete.label}"? Hackers and mentors will no longer see it.`
            : ""
        }
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
