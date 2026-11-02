"use client";

/**
 * The organiser's invitations: personal links to register, sent by e-mail.
 *
 * At the top what the invitation does for this event (invite-only, or a way
 * past a closed or full registration), the counts and the places they would
 * take; then the composer — paste addresses or upload a CSV (name, e-mail,
 * team), checked and de-duplicated as it is typed — and the list with each
 * invitation's status: not delivered, sent, opened, registered, expired,
 * withdrawn. Resend, withdraw and copy the link one by one or in bulk;
 * search, filter by status, export.
 *
 * The API decides everything again (who is skipped, the limits, the links);
 * this page only shows its answers. See participantInvite.service.js.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ClipboardPaste, Copy, Download, FileSpreadsheet, Lock, MailPlus, RefreshCw, RotateCcw, Send, Upload, Users, X, XCircle,
} from "lucide-react";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Badge, Button, Card, CardHeader, Tabs, buttonLook, type Tone } from "@/components/ds/primitives";
import { Notice, Select } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { useDemoBasePath } from "@/lib/demoPath";
import { ApiError, DemoReadOnlyError, apiGet, apiPost } from "@/lib/api";
import { downloadCSV } from "@/lib/csvExport";
import { readFileAsText } from "@/lib/csvImport";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import { tableLabels } from "@/lib/i18n/tableLabels";
import { formatRelativeTime } from "@/lib/relativeTime";
import {
  CSV_TEMPLATE, INVITE_ERRORS, INVITE_STATUSES, LINK_DAYS, MAX_BATCH, actionsFor, bulkTargets, normalizeInvitationsPage, normalizeSendResult,
  parseInviteCsv, parsePasted, skipCounts,
  type Invitation, type InvitationsPage, type InviteStatus, type ParsedList, type SendResult,
} from "@/lib/participantInvites";

const TONE: Record<InviteStatus, Tone> = {
  not_sent: "danger",
  sent: "neutral",
  opened: "info",
  registered: "ok",
  expired: "warn",
  revoked: "neutral",
};

const ink = (n: "" | "-2" | "-3" = "") => ({ color: `var(--ink${n})` });

/** `?status=opened` opens that tab. */
const tabFrom = (v: string | null): "all" | InviteStatus => ((INVITE_STATUSES as readonly string[]).includes(String(v)) ? (v as InviteStatus) : "all");

export default function InvitationsPage() {
  return (
    <Suspense fallback={null}>
      <Invitations />
    </Suspense>
  );
}

function Invitations() {
  const params = useSearchParams();
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const base = useDemoBasePath();
  const [data, setData] = useState<InvitationsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"all" | InviteStatus>(() => tabFrom(params.get("status")));
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: "send" | "resend"; r: SendResult; skippedHere?: number } | null>(null);
  const [revoking, setRevoking] = useState<number[] | null>(null);

  const words = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.code && (INVITE_ERRORS as readonly string[]).includes(err.code)) return t(`iv.err.${err.code}`);
    if (err instanceof ApiError && err.summary) return err.summary;
    return t("iv.failed");
  }, [t]);

  const load = useCallback(async () => {
    if (activeEventId == null) return;
    try {
      setData(normalizeInvitationsPage(await apiGet<unknown>(`/api/events/${activeEventId}/participant-invites`)));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    if (eventLoading) return;
    if (activeEventId == null) { setLoading(false); return; }
    setLoading(true);
    setResult(null);
    void load();
  }, [activeEventId, eventLoading, load]);

  const send = async (invitees: ParsedList["valid"], days: number) => {
    if (activeEventId == null || !invitees.length) return false;
    setBusy("send");
    try {
      const r = normalizeSendResult(await apiPost<unknown>(`/api/events/${activeEventId}/participant-invites`, { invitees, expiresInDays: days }));
      setResult({ kind: "send", r });
      await load();
      return true;
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err), "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const resend = async (ids: number[], skippedHere = 0) => {
    if (activeEventId == null || !ids.length) return;
    setBusy("resend");
    try {
      const r = normalizeSendResult(await apiPost<unknown>(`/api/events/${activeEventId}/participant-invites/resend`, { ids }));
      setResult({ kind: "resend", r, skippedHere });
      await load();
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (ids: number[]) => {
    if (activeEventId == null || !ids.length) return;
    setBusy("revoke");
    try {
      const r = await apiPost<{ revoked?: number[] }>(`/api/events/${activeEventId}/participant-invites/revoke`, { ids });
      toast(fill(t("iv.done.revoked"), { n: r?.revoked?.length ?? 0 }), "success");
      await load();
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (inv: Invitation) => {
    if (activeEventId == null) return;
    try {
      const r = await apiGet<{ url?: string }>(`/api/events/${activeEventId}/participant-invites/${inv.id}/link`);
      if (!r?.url) throw new Error("no link");
      try {
        await navigator.clipboard.writeText(r.url);
        toast(fill(t("iv.done.copied"), { email: inv.email }), "success");
      } catch {
        toast(fill(t("iv.done.copy_manual"), { url: r.url }), "info", 15000);
      }
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err), "error");
    }
  };

  const rows = useMemo(() => data?.items ?? [], [data]);
  const shown = useMemo(() => (tab === "all" ? rows : rows.filter((r) => r.status === tab)), [rows, tab]);
  const date = (iso: string | null) => (iso ? formatDate(iso, lang, { day: "numeric", month: "short", year: "numeric" }) : "—");

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={ink("-3")}>{t("iv.no_event")}</p>;
  }

  const ev = data?.event;
  const canInvite = Boolean(ev && ev.published && !ev.archived);
  const builderHref = activeEventId != null && !base ? `/create-event/${activeEventId}` : null;

  const actions = (inv: Invitation) => {
    const can = actionsFor(inv);
    // Icons in the row (the label is the button's name and its tooltip), so a row stays one line.
    const btn = (key: string, label: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
      <Button key={key} size="sm" variant="ghost" icon={icon} disabled={busy != null || !canInvite} aria-label={`${label}: ${inv.email}`} title={label}
        onClick={(e) => { e.stopPropagation(); onClick(); }} style={danger ? { color: "var(--danger)" } : undefined}>
        {/* Cards on phones have room for the words; the table shows the icon. */}
        <span className="md:hidden">{label}</span>
      </Button>
    );
    return [
      can.copy ? btn("cp", t("iv.act.copy"), <Copy size={13} />, () => void copyLink(inv)) : null,
      can.resend ? btn("rs", t("iv.act.resend"), <RotateCcw size={13} />, () => void resend([inv.id])) : null,
      can.revoke ? btn("rv", t("iv.act.revoke"), <XCircle size={13} />, () => setRevoking([inv.id]), true) : null,
    ].filter(Boolean);
  };

  const columns: Column<Invitation>[] = [
    {
      id: "person", header: t("iv.col.person"), value: (r) => `${r.fullName ?? ""} ${r.email}`, sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={ink()}>{r.fullName || r.email}</p>
          {r.fullName ? <p className="truncate text-xs" style={ink("-3")}>{r.email}</p> : null}
          {/* Phones show the team here: the card has room for four more fields, the actions among them. */}
          {r.team ? <p className="truncate text-xs md:hidden" style={ink("-2")}>{t("iv.col.team")}: {r.team}</p> : null}
        </div>
      ),
    },
    {
      id: "status", header: t("iv.col.status"), value: (r) => INVITE_STATUSES.indexOf(r.status), sortable: true,
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={TONE[r.status]} dot>{t(`iv.status.${r.status}`)}</Badge>
          {r.status === "registered" && r.participantStatus ? (
            <span className="text-[12px]" style={ink("-3")}>{fill(t("iv.registered_as"), { status: t(`pt.status.${r.participantStatus}`) })}</span>
          ) : null}
        </div>
      ),
    },
    { id: "team", header: t("iv.col.team"), value: (r) => r.team ?? "", sortable: true, hideOnCard: true, cell: (r) => (r.team ? <span style={ink()}>{r.team}</span> : <span style={ink("-3")}>—</span>) },
    {
      id: "sent", header: t("iv.col.sent"), value: (r) => (r.sentAt ? new Date(r.sentAt).getTime() : 0), sortable: true,
      cell: (r) => <span className="whitespace-nowrap" style={ink("-2")}>{r.sentAt ? fill(t("iv.sent_times"), { when: formatRelativeTime(r.sentAt, lang), n: r.sendCount }) : "—"}</span>,
    },
    {
      id: "expires", header: t("iv.col.expires"), value: (r) => (r.expiresAt ? new Date(r.expiresAt).getTime() : 0), sortable: true,
      cell: (r) => <span className="whitespace-nowrap" style={r.status === "expired" ? { color: "var(--warn)" } : ink("-2")}>{r.status === "registered" || r.status === "revoked" ? "—" : date(r.expiresAt)}</span>,
    },
    { id: "by", header: t("iv.col.by"), value: (r) => r.invitedBy ?? "", optional: true },
    {
      id: "actions", header: "", value: () => "",
      cell: (r) => <div className="flex flex-wrap justify-end gap-0.5 md:flex-nowrap" role="group" aria-label={fill(t("iv.act.actions"), { email: r.email })}>{actions(r)}</div>,
    },
  ];

  const cap = data?.capacity;
  const counts = data?.counts;
  const open = counts ? counts.not_sent + counts.sent + counts.opened : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={ink()}>{t("iv.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={ink("-2")}>{t("iv.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={activeEventId != null && !base ? `/api/events/${activeEventId}/participant-invites/export.csv` : undefined}
            download
            aria-disabled={!rows.length || Boolean(base)}
            {...buttonLook("secondary", "sm")}
            style={!rows.length || base ? { pointerEvents: "none", opacity: 0.5 } : undefined}
          >
            <Download size={14} aria-hidden="true" /> {t("iv.export")}
          </a>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()}>{t("iv.refresh")}</Button>
        </div>
      </div>

      {ev ? (
        !ev.published ? (
          <Notice tone="warn" icon={<Lock size={15} />}>
            {t("iv.not_published")}{" "}
            {builderHref ? <Link href={builderHref} className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("iv.open_builder")}</Link> : null}
          </Notice>
        ) : ev.archived ? (
          <Notice tone="info" icon={<Lock size={15} />}>{t("iv.archived")}</Notice>
        ) : (
          <Notice tone="info" icon={<MailPlus size={15} />}>{t(`iv.vis.${ev.visibility}`)}</Notice>
        )
      ) : null}

      {counts && cap ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: t("iv.stat.invited"), value: counts.total },
              { label: t("iv.stat.opened"), value: counts.opened },
              { label: t("iv.stat.registered"), value: counts.registered },
              { label: t("iv.stat.open"), value: open },
            ].map((s) => (
              <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={ink("-3")}>{s.label}</p>
                <p className="mt-1 text-[24px] font-bold tabular-nums" style={ink()}>{s.value}</p>
              </div>
            ))}
          </div>
          <CapacityCard cap={cap} builderHref={builderHref ? `${builderHref}?section=registration` : null} />
        </>
      ) : null}

      <Composer disabled={!canInvite || loading} busy={busy === "send"} defaultDays={data?.limits.defaultDays ?? 14} onSend={send} />

      {result ? <ResultBanner result={result} onDismiss={() => setResult(null)} /> : null}

      <section aria-label={t("iv.list.title")} className="space-y-3">
        <h2 className="text-[15px] font-semibold" style={ink()}>{t("iv.list.title")}</h2>
        <div role="tablist" aria-label={t("iv.col.status")} className="flex flex-wrap gap-1.5">
          {(["all", ...INVITE_STATUSES] as const).map((s) => {
            const n = s === "all" ? rows.length : counts?.[s] ?? 0;
            const on = tab === s;
            if (s !== "all" && n === 0 && !on) return null;
            return (
              <button
                key={s}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(s)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors"
                style={{ borderColor: on ? "var(--accent-solid)" : "var(--line-strong)", background: on ? "var(--accent-weak)" : "var(--surface)", color: "var(--ink)" }}
              >
                {s === "all" ? t("iv.tab.all") : t(`iv.status.${s}`)}
                <span className="tabular-nums" style={ink("-3")}>{n}</span>
              </button>
            );
          })}
        </div>
        <DataTable
          rows={shown}
          columns={columns}
          loading={loading}
          error={failed && rows.length === 0}
          onRetry={() => void load()}
          searchPlaceholder={t("iv.search")}
          emptyTitle={rows.length === 0 ? t("iv.empty") : t("iv.empty_tab")}
          emptyBody={rows.length === 0 ? t("iv.empty_hint") : undefined}
          pageSize={25}
          labels={tableLabels(t)}
          bulkActions={canInvite ? [
            {
              id: "resend", label: t("iv.act.resend"),
              onRun: (ids) => { const x = bulkTargets(rows, ids, "resend"); void resend(x.ids, x.skipped); },
            },
            {
              id: "revoke", label: t("iv.act.revoke"), tone: "danger",
              onRun: (ids) => { const x = bulkTargets(rows, ids, "revoke"); if (x.ids.length) setRevoking(x.ids); else toast(fill(t("iv.bulk.skipped"), { n: x.skipped }), "info"); },
            },
          ] : []}
        />
      </section>

      <ConfirmDialog
        open={revoking != null}
        title={t("iv.confirm_revoke_t")}
        message={fill(t("iv.confirm_revoke_b"), { n: revoking?.length ?? 0 })}
        confirmLabel={t("iv.act.revoke")}
        cancelLabel={t("iv.confirm_cancel")}
        variant="danger"
        onCancel={() => setRevoking(null)}
        onConfirm={() => { const ids = revoking ?? []; setRevoking(null); void revoke(ids); }}
      />
    </div>
  );
}

/* ── Places ──────────────────────────────────────────────────────────────── */

function CapacityCard({ cap, builderHref }: { cap: InvitationsPage["capacity"]; builderHref: string | null }) {
  const { t } = useTranslation();
  const pct = cap.limit ? Math.min(100, Math.round((cap.taken / cap.limit) * 100)) : 0;
  const pctOpen = cap.limit ? Math.min(100 - pct, Math.round((cap.outstanding / cap.limit) * 100)) : 0;
  return (
    <section aria-label={t("iv.cap.title")} className="rounded-[var(--radius)] border px-5 py-4" style={{ borderColor: cap.overBy ? "var(--warn)" : "var(--line)", background: "var(--surface)" }}>
      <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold" style={ink()}>
        <Users size={16} aria-hidden="true" />
        {cap.limit != null ? fill(t("iv.cap.of"), { taken: cap.taken, limit: cap.limit }) : fill(t("iv.cap.nolimit"), { taken: cap.taken })}
      </p>
      {cap.limit != null ? (
        <div className="mt-2.5 flex h-2 w-full max-w-xl overflow-hidden rounded-full" style={{ background: "var(--tint)" }} role="img"
          aria-label={`${fill(t("iv.cap.of"), { taken: cap.taken, limit: cap.limit })}. ${fill(t("iv.cap.outstanding"), { n: cap.outstanding })}`}>
          <span className="h-full" style={{ width: `${pct}%`, background: "var(--accent-solid)" }} />
          <span className="h-full" style={{ width: `${pctOpen}%`, background: "color-mix(in srgb, var(--accent-solid) 35%, transparent)" }} />
        </div>
      ) : null}
      <p className="mt-2 text-[12.5px] leading-relaxed" style={ink("-3")}>
        {fill(t("iv.cap.outstanding"), { n: cap.outstanding })}
        {builderHref ? <>{" · "}<Link href={builderHref} className="underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>{t("iv.cap.change")}</Link></> : null}
      </p>
      {cap.overBy > 0 ? <p className="mt-1 text-[12.5px] font-medium leading-snug" style={{ color: "var(--warn)" }}>{fill(t("iv.cap.over"), { n: cap.overBy })}</p> : null}
    </section>
  );
}

/* ── The composer ────────────────────────────────────────────────────────── */

function Composer({ disabled, busy, defaultDays, onSend }: {
  disabled: boolean;
  busy: boolean;
  defaultDays: number;
  onSend: (invitees: ParsedList["valid"], days: number) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [mode, setMode] = useState<"paste" | "csv">("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; rows: number; parsed: ParsedList; columns: { name: boolean; team: boolean } } | null>(null);
  const [days, setDays] = useState(String((LINK_DAYS as readonly number[]).includes(defaultDays) ? defaultDays : 14));
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed: ParsedList = useMemo(
    () => (mode === "paste" ? parsePasted(text) : file?.parsed ?? { valid: [], invalid: [], duplicates: [] }),
    [mode, text, file],
  );
  const tooMany = parsed.valid.length > MAX_BATCH;

  const readCsv = async (f: File) => {
    try {
      const content = await readFileAsText(f);
      const p = parseInviteCsv(content);
      if (!p.valid.length && !p.invalid.length) { toast(t("iv.csv.no_email"), "error"); return; }
      setFile({ name: f.name, rows: p.valid.length + p.invalid.length + p.duplicates.length, parsed: p, columns: p.columns });
    } catch {
      toast(t("iv.csv.failed"), "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!parsed.valid.length || tooMany) return;
    const ok = await onSend(parsed.valid, Number(days) || 14);
    if (ok) { setText(""); setFile(null); }
  };

  const preview = parsed.valid.slice(0, 6);
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><MailPlus size={15} aria-hidden="true" />{t("iv.new.title")}</span>} hint={t("iv.new.hint")} />
      <Tabs
        value={mode}
        onChange={setMode}
        tabs={[
          { id: "paste", label: t("iv.tab.paste") },
          { id: "csv", label: t("iv.tab.csv") },
        ]}
      />
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          {mode === "paste" ? (
            <div>
              <label htmlFor="iv-paste" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium" style={ink()}>
                <ClipboardPaste size={14} aria-hidden="true" />{t("iv.paste.label")}
              </label>
              <textarea
                id="iv-paste"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("iv.paste.placeholder")}
                rows={7}
                disabled={disabled}
                spellCheck={false}
                aria-describedby="iv-paste-help"
                className="w-full resize-y rounded-[var(--radius-sm)] border px-3 py-2.5 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-2"
                style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
              />
              <p id="iv-paste-help" className="mt-1.5 text-[12.5px] leading-relaxed" style={ink("-3")}>{t("iv.paste.help")}</p>
            </div>
          ) : (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium" style={ink()}><FileSpreadsheet size={14} aria-hidden="true" />{t("iv.csv.label")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" icon={<Upload size={14} />} disabled={disabled} onClick={() => fileRef.current?.click()}>{t("iv.csv.choose")}</Button>
                <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => downloadCSV("invitations-template.csv", CSV_TEMPLATE)}>{t("iv.csv.template")}</Button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readCsv(f); }} />
              </div>
              {file ? (
                <p className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-[12.5px]" style={{ background: "var(--tint)", color: "var(--ink)" }}>
                  <FileSpreadsheet size={13} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{fill(t("iv.csv.file"), { name: file.name, n: file.rows })}</span>
                  <button type="button" onClick={() => setFile(null)} aria-label={t("iv.csv.clear")} className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--surface)]"><X size={13} /></button>
                </p>
              ) : null}
              <p className="mt-2 text-[12.5px] leading-relaxed" style={ink("-3")}>{t("iv.csv.help")}</p>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Select
              className="w-44"
              label={t("iv.days.label")}
              value={days}
              onChange={setDays}
              options={LINK_DAYS.map((n) => ({ value: String(n), label: fill(t("iv.days.option"), { n }) }))}
            />
            <Button variant="primary" size="md" icon={<Send size={15} />} loading={busy} disabled={disabled || busy || !parsed.valid.length || tooMany} onClick={() => void submit()}>
              {parsed.valid.length ? fill(t("iv.send_n"), { n: parsed.valid.length }) : t("iv.send")}
            </Button>
          </div>
        </div>
        <aside aria-live="polite" className="min-w-0 rounded-[var(--radius-sm)] border p-3.5" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={ink("-3")}>{t("iv.check.preview")}</p>
          <ul className="mt-2 space-y-1 text-[13px]">
            <li className="flex items-center gap-2 font-medium" style={ink()}>
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: parsed.valid.length ? "var(--ok)" : "var(--line-strong)" }} />
              {fill(t("iv.check.valid"), { n: parsed.valid.length })}
            </li>
            {parsed.duplicates.length ? (
              <li className="flex items-center gap-2" style={ink("-2")}>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--info)" }} />
                {fill(t("iv.check.duplicates"), { n: parsed.duplicates.length })}
              </li>
            ) : null}
            {parsed.invalid.length ? (
              <li className="flex items-center gap-2" style={{ color: "var(--danger)" }}>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--danger)" }} />
                {fill(t("iv.check.invalid"), { n: parsed.invalid.length })}
              </li>
            ) : null}
          </ul>
          {parsed.invalid.length ? (
            <p className="mt-2 break-all font-mono text-[12px]" style={{ color: "var(--danger)" }}>
              {parsed.invalid.slice(0, 5).join(", ")}{parsed.invalid.length > 5 ? ` ${fill(t("iv.check.more"), { n: parsed.invalid.length - 5 })}` : ""}
            </p>
          ) : null}
          {tooMany ? <p className="mt-2 text-[12.5px] font-medium" style={{ color: "var(--danger)" }}>{fill(t("iv.check.too_many"), { n: MAX_BATCH })}</p> : null}
          {preview.length ? (
            <ul className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: "var(--line)" }}>
              {preview.map((p) => (
                <li key={p.email} className="min-w-0 text-[12.5px]">
                  <span className="block truncate" style={ink()}>{p.fullName ? `${p.fullName} · ` : ""}{p.email}</span>
                  {p.team ? <span className="block truncate" style={ink("-3")}>{p.team}</span> : null}
                </li>
              ))}
              {parsed.valid.length > preview.length ? <li className="text-[12px]" style={ink("-3")}>{fill(t("iv.check.more"), { n: parsed.valid.length - preview.length })}</li> : null}
            </ul>
          ) : null}
        </aside>
      </div>
    </Card>
  );
}

/* ── What a send did ─────────────────────────────────────────────────────── */

function ResultBanner({ result, onDismiss }: { result: { kind: "send" | "resend"; r: SendResult; skippedHere?: number }; onDismiss: () => void }) {
  const { t } = useTranslation();
  const { r } = result;
  const lines: string[] = [];
  if (r.sent) lines.push(fill(t(result.kind === "send" ? "iv.done.sent" : "iv.done.resent"), { n: r.sent }));
  if (r.reinvited.length) lines.push(fill(t("iv.done.reinvited"), { n: r.reinvited.length }));
  if (r.renewed) lines.push(fill(t("iv.done.renewed"), { n: r.renewed }));
  if (r.failed) lines.push(fill(t("iv.done.failed"), { n: r.failed }));
  const skips = skipCounts(r.skipped).map((s) => fill(t(`iv.skip.${s.reason}`), { n: s.n }));
  if (r.duplicates) skips.push(fill(t("iv.check.duplicates"), { n: r.duplicates }));
  if (r.invalid.length) skips.push(fill(t("iv.check.invalid"), { n: r.invalid.length }));
  if (result.skippedHere) skips.push(fill(t("iv.bulk.skipped"), { n: result.skippedHere }));
  if (!lines.length) lines.push(t("iv.done.none"));
  const tone = r.failed ? "warn" : r.sent ? "ok" : "info";
  return (
    <div role="status" className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius)] border px-4 py-3"
      style={{ borderColor: tone === "ok" ? "color-mix(in srgb, var(--ok) 40%, var(--line))" : tone === "warn" ? "var(--warn)" : "var(--line)", background: tone === "ok" ? "var(--ok-weak)" : tone === "warn" ? "var(--warn-weak)" : "var(--tint)" }}>
      <div className="min-w-0 flex-1 text-[13.5px]" style={ink()}>
        <p className="font-medium">{lines.join(" ")}</p>
        {skips.length ? <ul className="mt-1 list-disc pl-5 text-[13px]" style={ink("-2")}>{skips.map((s) => <li key={s}>{s}</li>)}</ul> : null}
      </div>
      <Button size="sm" variant="ghost" onClick={onDismiss}>{t("iv.done.dismiss")}</Button>
    </div>
  );
}
