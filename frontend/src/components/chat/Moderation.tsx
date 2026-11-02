"use client";

/**
 * The organisers' moderation lists: reported messages (keep or remove, open
 * the channel) and the people muted in the event's chat (lift the mute).
 */

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Flag, RefreshCw, Trash2, Volume2 } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ds/primitives";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadFailure } from "@/components/LoadFailure";
import { MessageText } from "@/components/chat/MessageText";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { DemoReadOnlyError } from "@/lib/api";
import { chatApi, chatErrorKey, type ChatMute, type ChatReport } from "@/lib/chat";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";

const when = (iso: string | null, lang: string) =>
  iso ? formatDate(iso, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";

function usePanel<T>(load: () => Promise<T[]>) {
  const [state, setState] = useState<{ rows: T[] | null; failed: boolean }>({ rows: null, failed: false });
  const reload = useCallback(async () => {
    try {
      const rows = await load();
      setState({ rows, failed: false });
    } catch {
      setState((s) => ({ rows: s.rows, failed: true }));
    }
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (rows) => { if (!cancelled) setState({ rows, failed: false }); },
      () => { if (!cancelled) setState({ rows: null, failed: true }); },
    );
    return () => { cancelled = true; };
  }, [load]);
  return { ...state, reload };
}

export function ReportsPanel({
  eventId, onOpenChannel, onChanged,
}: {
  eventId: number;
  onOpenChannel: (channelId: number) => void;
  /** A report was dealt with (the tab's count follows). */
  onChanged?: () => void;
}) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const load = useCallback(() => chatApi.reports(eventId), [eventId]);
  const { rows, failed, reload } = usePanel<ChatReport>(load);
  const [busy, setBusy] = useState<number | null>(null);
  const [toRemove, setToRemove] = useState<ChatReport | null>(null);

  const act = async (r: ChatReport, action: "dismiss" | "remove") => {
    setBusy(r.messageId);
    try {
      await chatApi.resolve(eventId, r.messageId, action);
      toast(t(action === "remove" ? "ch.removed_ok" : "ch.kept_ok"), "success");
      await reload();
      onChanged?.();
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(t(chatErrorKey(err)), "error");
    } finally {
      setBusy(null);
    }
  };

  if (rows == null) return failed ? <LoadFailure message={t("ch.reports_failed")} onRetry={() => void reload()} /> : <div className="hs-skeleton h-40 rounded-[var(--radius)]" aria-busy="true" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>{t("ch.reports_hint")}</p>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void reload()}>{t("ch.refresh")}</Button>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          <EmptyState icon={<Flag size={19} />} title={t("ch.reports_none")} body={t("ch.reports_none_body")} />
        </div>
      ) : (
        <ul className="m-0 list-none space-y-2.5 p-0">
          {rows.map((r) => (
            <li key={r.messageId} className="rounded-[var(--radius)] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{r.author?.name || t("ch.someone")}</p>
                  <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
                    {[r.channelKind === "team" && r.teamName ? r.teamName : t(`ch.kind.${r.channelKind === "support" ? "support_person" : r.channelKind}`), when(r.createdAt, lang)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge tone="danger">{fill(t(r.reports === 1 ? "ch.reports_one" : "ch.reports_many"), { n: r.reports })}</Badge>
              </div>
              <blockquote className="mt-2.5 rounded-[var(--radius-sm)] border-l-2 px-3 py-2 text-[14px]" style={{ borderColor: "var(--danger)", background: "var(--surface-sunken)", color: "var(--ink)" }}>
                <MessageText text={r.body} />
              </blockquote>
              {r.reasons.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
                  {r.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => onOpenChannel(r.channelId)}>{t("ch.open_channel")}</Button>
                <Button size="sm" variant="secondary" icon={<Check size={13} />} disabled={busy != null} loading={busy === r.messageId} onClick={() => void act(r, "dismiss")}>{t("ch.keep")}</Button>
                <Button size="sm" variant="danger" icon={<Trash2 size={13} />} disabled={busy != null} onClick={() => setToRemove(r)}>{t("ch.remove")}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(toRemove)}
        title={t("ch.remove_title")}
        message={t("ch.remove_body")}
        confirmLabel={t("ch.remove")}
        cancelLabel={t("ch.cancel")}
        variant="danger"
        onCancel={() => setToRemove(null)}
        onConfirm={() => { const r = toRemove; setToRemove(null); if (r) void act(r, "remove"); }}
      />
    </div>
  );
}

export function MutesPanel({ eventId }: { eventId: number }) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const load = useCallback(() => chatApi.mutes(eventId), [eventId]);
  const { rows, failed, reload } = usePanel<ChatMute>(load);
  const [busy, setBusy] = useState<number | null>(null);

  const lift = async (m: ChatMute) => {
    setBusy(m.userId);
    try {
      await chatApi.unmute(eventId, m.userId);
      toast(fill(t("ch.unmuted_ok"), { name: m.name }), "success");
      await reload();
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(t(chatErrorKey(err)), "error");
    } finally {
      setBusy(null);
    }
  };

  if (rows == null) return failed ? <LoadFailure message={t("ch.mutes_failed")} onRetry={() => void reload()} /> : <div className="hs-skeleton h-40 rounded-[var(--radius)]" aria-busy="true" />;

  return (
    <div className="space-y-3">
      <p className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>{t("ch.mutes_hint")}</p>
      {rows.length === 0 ? (
        <div className="rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          <EmptyState icon={<Volume2 size={19} />} title={t("ch.mutes_none")} />
        </div>
      ) : (
        <ul className="m-0 list-none divide-y rounded-[var(--radius)] border p-0" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          {rows.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: "var(--line)" }}>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{m.name}</p>
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
                  {[m.until ? fill(t("ch.muted_until"), { time: when(m.until, lang) }) : t("ch.muted_forever"), m.mutedBy ? fill(t("ch.muted_by"), { name: m.mutedBy }) : null].filter(Boolean).join(" · ")}
                </p>
                {m.reason ? <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>{m.reason}</p> : null}
              </div>
              <Button size="sm" variant="secondary" icon={<Volume2 size={13} />} disabled={busy != null} loading={busy === m.userId} onClick={() => void lift(m)}>{t("ch.unmute")}</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
