"use client";

/**
 * One announcement in the organiser's list: what it says, who it was for,
 * when it went (or goes) out, how each channel did, and what can still be
 * done with it.
 */

import { useState } from "react";
import { AlertTriangle, Bot, Megaphone, Pencil, Send, Trash2, XCircle, Users, Mail, UserX } from "lucide-react";
import { Badge, Button, type Tone } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { formatRelativeTime } from "@/lib/relativeTime";
import {
  DELIVERY_KINDS, normalizeProblems,
  type AdminAnnouncement, type DeliveryKind, type DeliveryProblem,
} from "@/lib/announcementsAdmin";
import { formatDate } from "@/lib/i18n/dates";

const PRIORITY_TONE: Record<AdminAnnouncement["priority"], Tone> = { normal: "neutral", high: "warn", urgent: "danger" };
const KIND_ICON: Record<DeliveryKind, React.ReactNode> = {
  email: <Mail size={12} aria-hidden="true" />,
  telegram: <Send size={12} aria-hidden="true" />,
  telegram_channel: <Megaphone size={12} aria-hidden="true" />,
};

function absolute(iso: string | null, lang: string, timeZone: string) {
  if (!iso) return "";
  return formatDate(iso, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }) || iso;
}

export function AnnouncementRow({
  a, timeZone, onEdit, onSendNow, onCancel, onDelete,
}: {
  a: AdminAnnouncement;
  timeZone: string;
  onEdit: () => void;
  onSendNow: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t, lang } = useTranslation();
  const [problems, setProblems] = useState<DeliveryProblem[] | null>(null);
  const [open, setOpen] = useState(false);

  const showProblems = async () => {
    setOpen(true);
    setProblems(null);
    try {
      setProblems(normalizeProblems(await apiGet(`/api/announcements/${a.id}/deliveries`)));
    } catch {
      setProblems([]);
    }
  };

  const kinds = DELIVERY_KINDS.filter((k) => a.deliveries[k]);
  const troubled = kinds.some((k) => (a.deliveries[k]?.failed || 0) + (a.deliveries[k]?.skipped || 0) > 0);
  const audience = a.audience === "track" && a.trackName ? `${t("an.aud.track")}: ${a.trackName}` : t(`an.aud.${a.audience}`);
  const muted = a.status === "cancelled";

  return (
    <article
      className="rounded-[var(--radius)] border p-4 transition-colors"
      style={{ borderColor: a.status === "scheduled" ? "var(--info)" : "var(--line)", background: "var(--surface)", opacity: muted ? 0.65 : 1 }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)]"
          style={{ background: a.priority === "urgent" ? "var(--danger-weak)" : a.priority === "high" ? "var(--warn-weak)" : "var(--tint)", color: a.priority === "urgent" ? "var(--danger)" : a.priority === "high" ? "var(--warn)" : "var(--ink-2)" }}
        >
          {a.priority === "normal" ? <Megaphone size={15} /> : <AlertTriangle size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="mr-1 text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>{a.title}</h3>
            {a.priority !== "normal" ? <Badge tone={PRIORITY_TONE[a.priority]}>{t(`an.prio.${a.priority}`)}</Badge> : null}
            {a.status === "scheduled" ? <Badge tone="info" dot>{fill(t("an.status.scheduled"), { time: absolute(a.scheduledAt, lang, timeZone) })}</Badge> : null}
            {a.status === "cancelled" ? <Badge tone="neutral">{t("an.status.cancelled")}</Badge> : null}
            {a.source === "auto" ? <Badge tone="brand"><Bot size={11} aria-hidden="true" />{t("an.src.auto")}</Badge> : null}
            {a.source === "telegram" ? <Badge tone="info"><Send size={11} aria-hidden="true" />{t("an.src.telegram")}</Badge> : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
            <span className="inline-flex items-center gap-1"><Users size={11} aria-hidden="true" />{fill(t("an.to"), { audience })}</span>
            {a.status === "sent" && a.sentAt ? <span title={absolute(a.sentAt, lang, timeZone)}>· {fill(t("an.status.sent"), { time: formatRelativeTime(a.sentAt, lang) })}</span> : null}
            {a.authorName ? <span>· {fill(t("an.by"), { name: a.authorName })}</span> : null}
          </p>
          <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{a.content}</p>

          {kinds.length ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("an.f_channels")}>
              {kinds.map((k) => {
                const c = a.deliveries[k]!;
                const parts = [
                  c.sent ? fill(t("an.d.sent"), { n: c.sent }) : null,
                  c.pending ? fill(t("an.d.pending"), { n: c.pending }) : null,
                  c.failed ? fill(t("an.d.failed"), { n: c.failed }) : null,
                  c.skipped ? fill(t("an.d.skipped"), { n: c.skipped }) : null,
                ].filter(Boolean);
                const tone: Tone = c.failed ? "danger" : c.pending ? "info" : c.skipped && !c.sent ? "warn" : "ok";
                return (
                  <li key={k}>
                    <Badge tone={tone}>{KIND_ICON[k]}{t(`an.d.${k}`)}: {parts.join(" · ") || "—"}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {a.status !== "cancelled" ? (
              <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={onEdit}>{t("an.act.edit")}</Button>
            ) : null}
            {a.status === "scheduled" ? (
              <>
                <Button size="sm" variant="secondary" icon={<Send size={13} />} onClick={onSendNow}>{t("an.act.send_now")}</Button>
                <Button size="sm" variant="ghost" icon={<XCircle size={13} />} onClick={onCancel}>{t("an.act.cancel")}</Button>
              </>
            ) : null}
            {troubled ? (
              <Button size="sm" variant="ghost" icon={<UserX size={13} />} onClick={showProblems}>{t("an.act.problems")}</Button>
            ) : null}
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={onDelete} style={{ color: "var(--danger)" }}>{t("an.act.delete")}</Button>
          </div>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t("an.problems_title")} description={a.title}
        footer={<Button size="sm" onClick={() => setOpen(false)}>{t("an.problems_close")}</Button>}>
        {problems === null ? (
          <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>…</p>
        ) : problems.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>{t("an.problems_empty")}</p>
        ) : (
          <ul className="max-h-[50vh] divide-y overflow-y-auto" style={{ borderColor: "var(--line)" }}>
            {problems.map((p) => (
              <li key={p.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0" style={{ color: p.status === "failed" ? "var(--danger)" : "var(--warn)" }}>{KIND_ICON[p.channel]}</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                    {p.name || t(`an.d.${p.channel}`)}{p.email ? <span className="font-normal" style={{ color: "var(--ink-3)" }}> · {p.email}</span> : null}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>{p.lastError || "—"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </article>
  );
}
