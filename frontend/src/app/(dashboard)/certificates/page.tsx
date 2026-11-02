"use client";

/**
 * The organiser's certificates.
 *
 * What the builder says will be issued (kinds, signer, signature, whether
 * they follow the results), who that comes to — and how many of them are
 * still to issue — and every certificate issued so far: download its PDF,
 * copy the link its holder can show anyone, send it again by e-mail, revoke
 * it or bring it back. Issuing never makes a second certificate for the same
 * person and kind, so pressing the button twice is harmless.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award, Copy, Download, ExternalLink, Mail, MailCheck, Pencil, RefreshCw, RotateCcw, Send, ShieldX, Trophy,
} from "lucide-react";
import { DataTable, type Column, type Facet } from "@/components/ds/DataTable";
import { Badge, Button, buttonLook, Card, CardHeader, Skeleton } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";
import { Notice, Toggle } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadFailure } from "@/components/LoadFailure";
import { KIND_TONE, KindIcon, certificateTitle } from "@/components/wrapup/CertificateParts";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { DemoReadOnlyError, apiGet, apiPost, isDemoApiEnabled } from "@/lib/api";
import {
  CERT_KINDS, LIST_STATES, MAIL_STATES, certErrorKey, certificatePdfPath, kindOf, normalizeCertificates, normalizePlan, verifyUrl,
  type CertKind, type CertificatePlan, type IssuedCertificate,
} from "@/lib/certificates";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import { tableLabels } from "@/lib/i18n/tableLabels";

interface Settings {
  kinds: CertKind[];
  signerName: string;
  signerTitle: string;
  signatureFileId: string | null;
  issueAfterResults: boolean;
  archived: boolean;
  resultsPublished: boolean;
}

interface Loaded {
  eventId: number;
  certs: IssuedCertificate[];
  plan: CertificatePlan | null;
  settings: Settings | null;
  failed: boolean;
}

type Confirm = { kind: "revoke" | "restore"; cert: IssuedCertificate } | null;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The certificate settings out of the builder's answer (null when it did not answer). */
function settingsFrom(raw: unknown): Settings | null {
  const ev = obj(obj(raw).event);
  if (ev.id == null) return null;
  const cc = obj(ev.certificate_config);
  const types = Array.isArray(cc.types) ? cc.types : [];
  return {
    kinds: types.map(kindOf).filter((k): k is CertKind => k != null),
    signerName: String(cc.signerName ?? "").trim(),
    signerTitle: String(cc.signerTitle ?? "").trim(),
    signatureFileId: cc.signatureFileId ? String(cc.signatureFileId) : null,
    issueAfterResults: cc.issueAfterResults !== false,
    archived: Boolean(ev.archived_at) || String(ev.status ?? "").toLowerCase() === "archived",
    resultsPublished: Boolean(ev.results_published_at),
  };
}

async function fetchAll(eventId: number): Promise<Loaded> {
  const [list, plan, builder] = await Promise.all([
    apiGet<unknown>(`/api/events/${eventId}/certificates`),
    apiGet<unknown>(`/api/events/${eventId}/certificates/plan`),
    apiGet<unknown>(`/api/events/${eventId}/builder`).catch(() => null),
  ]);
  return { eventId, certs: normalizeCertificates(list), plan: normalizePlan(plan), settings: settingsFrom(builder), failed: false };
}

export default function CertificatesPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [data, setData] = useState<Loaded | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (activeEventId == null) return;
    let cancelled = false;
    fetchAll(activeEventId).then(
      (d) => { if (!cancelled) setData(d); },
      () => { if (!cancelled) setData({ eventId: activeEventId, certs: [], plan: null, settings: null, failed: true }); },
    );
    return () => { cancelled = true; };
  }, [activeEventId]);

  const reload = useCallback(async () => {
    if (activeEventId == null) return;
    setRefreshing(true);
    try {
      setData(await fetchAll(activeEventId));
    } catch {
      toast(t("ct.refresh_failed"), "error");
    } finally {
      setRefreshing(false);
    }
  }, [activeEventId, toast, t]);

  const current = data && data.eventId === activeEventId ? data : null;
  const loading = eventLoading || (activeEventId != null && !current);
  const certs = useMemo(() => current?.certs ?? [], [current]);
  const plan = current?.plan ?? null;
  const settings = current?.settings ?? null;
  const archived = Boolean(settings?.archived);

  /** A write refused in the walkthrough is announced by the walkthrough itself. */
  const fail = (err: unknown) => {
    if (err instanceof DemoReadOnlyError) return;
    toast(t(certErrorKey(err)), "error");
  };

  const issue = async (kinds: CertKind[] | null, email: boolean) => {
    if (activeEventId == null) return;
    setBusy(true);
    try {
      const out = await apiPost<{ issued?: number; emailsQueued?: number }>(`/api/events/${activeEventId}/certificates/issue`, {
        ...(kinds ? { kinds } : {}),
        email,
      });
      const issued = Number(out?.issued ?? 0);
      const queued = Number(out?.emailsQueued ?? 0);
      if (!issued) toast(t("ct.issued_none"), "info");
      else toast(fill(t(queued ? "ct.issued_mailed" : "ct.issued"), { n: issued, m: queued }), "success");
      setIssueOpen(false);
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const resend = async (ids: number[] | null) => {
    if (activeEventId == null) return;
    try {
      const out = await apiPost<{ queued?: number }>(`/api/events/${activeEventId}/certificates/email`, ids ? { ids } : {});
      const n = Number(out?.queued ?? 0);
      toast(n ? fill(t("ct.mail_queued"), { n }) : t("ct.mail_none"), n ? "success" : "info");
      await reload();
    } catch (err) {
      fail(err);
    }
  };

  const setRevoked = async (cert: IssuedCertificate, revoke: boolean) => {
    if (activeEventId == null) return;
    try {
      await apiPost(`/api/events/${activeEventId}/certificates/${cert.id}/${revoke ? "revoke" : "restore"}`, {});
      toast(t(revoke ? "ct.revoked_done" : "ct.restored_done"), "success");
      await reload();
    } catch (err) {
      fail(err);
    }
  };

  const copyLink = async (cert: IssuedCertificate) => {
    const url = verifyUrl(cert.code);
    try {
      await navigator.clipboard.writeText(url);
      toast(t("ct.link_copied"), "success");
    } catch {
      toast(url, "info", 12000);
    }
  };

  const day = (iso: string | null) => (iso ? formatDate(iso, lang, { day: "numeric", month: "short", year: "numeric" }) : "");
  const valid = certs.filter((c) => !c.revokedAt);
  const unsent = valid.filter((c) => !c.emailedAt).length;

  const columns: Column<IssuedCertificate>[] = [
    {
      id: "name", header: t("ct.col.name"), sortable: true,
      value: (c) => `${c.name} ${c.email ?? ""} ${c.code}`,
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{c.name}</p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{c.email ?? c.code}</p>
        </div>
      ),
    },
    {
      id: "kind", header: t("ct.col.kind"), sortable: true,
      // Kind first, then place (zero-padded so 10th sorts after 2nd), then the words for the search.
      value: (c) => `${CERT_KINDS.indexOf(c.kind)} ${String(c.place ?? 999).padStart(3, "0")} ${certificateTitle(t, lang, c)}`,
      cell: (c) => (
        <div className="min-w-0">
          <Badge tone={KIND_TONE[c.kind]}><KindIcon kind={c.kind} size={12} /> {certificateTitle(t, lang, c)}</Badge>
          {c.kind === "winner" && c.title ? <p className="mt-1 truncate text-xs" style={{ color: "var(--ink-3)" }}>{c.title}</p> : null}
        </div>
      ),
    },
    { id: "team", header: t("ct.col.team"), sortable: true, value: (c) => c.teamName ?? "", cell: (c) => <span style={{ color: c.teamName ? "var(--ink-2)" : "var(--ink-3)" }}>{c.teamName ?? "—"}</span> },
    { id: "issued", header: t("ct.col.issued"), sortable: true, value: (c) => c.issuedAt ?? "", cell: (c) => <span className="whitespace-nowrap text-[13px]" style={{ color: "var(--ink-2)" }}>{day(c.issuedAt)}</span> },
    {
      id: "mail", header: t("ct.col.mail"), sortable: true, value: (c) => c.emailedAt ?? "",
      cell: (c) => (c.emailedAt
        ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]" style={{ color: "var(--ink-2)" }}><MailCheck size={13} aria-hidden="true" style={{ color: "var(--ok)" }} />{day(c.emailedAt)}</span>
        : <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("ct.not_sent")}</span>),
    },
    {
      id: "state", header: t("ct.col.state"), sortable: true, value: (c) => (c.revokedAt ? 1 : 0),
      cell: (c) => (c.revokedAt ? <Badge tone="danger" dot>{t("ct.state.revoked")}</Badge> : <Badge tone="ok" dot>{t("ct.state.valid")}</Badge>),
    },
    {
      id: "actions", header: "", value: () => "", align: "right", sortable: false,
      cell: (c) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {activeEventId != null ? (
            <a href={certificatePdfPath(activeEventId, c.id)} {...buttonLook("ghost", "sm")} aria-label={t("ct.download")} title={t("ct.download")}
              onClick={(e) => { if (isDemoApiEnabled()) { e.preventDefault(); window.dispatchEvent(new CustomEvent("hackos:demo-write")); } }}>
              <Download size={13} aria-hidden="true" />
            </a>
          ) : null}
          <Button size="sm" variant="ghost" icon={<Copy size={13} />} aria-label={t("ct.copy_link")} title={t("ct.copy_link")} onClick={() => void copyLink(c)} />
          {!c.revokedAt ? (
            <Button size="sm" variant="ghost" icon={<Mail size={13} />} aria-label={t("ct.resend")} title={t("ct.resend")} onClick={() => void resend([c.id])} />
          ) : null}
          {c.revokedAt ? (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} aria-label={t("ct.restore")} title={t("ct.restore")} disabled={archived}
              onClick={() => setConfirm({ kind: "restore", cert: c })} />
          ) : (
            <Button size="sm" variant="ghost" icon={<ShieldX size={13} />} aria-label={t("ct.revoke")} title={t("ct.revoke")} disabled={archived}
              style={{ color: "var(--danger)" }} onClick={() => setConfirm({ kind: "revoke", cert: c })} />
          )}
        </div>
      ),
    },
  ];

  const facets: Facet<IssuedCertificate>[] = [
    {
      id: "kind", label: t("ct.col.kind"),
      options: CERT_KINDS.filter((k) => certs.some((c) => c.kind === k)).map((k) => ({ value: k, label: t(`ct.kind.${k}`) })),
      match: (c, sel) => sel.includes(c.kind),
    },
    {
      id: "state", label: t("ct.col.state"),
      options: LIST_STATES.map((s) => ({ value: s, label: t(`ct.state.${s}`) })),
      match: (c, sel) => sel.includes(c.revokedAt ? "revoked" : "valid"),
    },
    {
      id: "mail", label: t("ct.col.mail"),
      options: MAIL_STATES.map((s) => ({ value: s, label: t(`ct.mail.${s}`) })),
      match: (c, sel) => sel.includes(c.emailedAt ? "sent" : "not_sent"),
    },
  ];

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("ct.no_event")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ct.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("ct.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />} onClick={() => void reload()} disabled={refreshing || loading}>
            {t("ct.refresh")}
          </Button>
          <Button size="sm" variant="primary" icon={<Award size={14} />} onClick={() => setIssueOpen(true)} disabled={loading || !plan || archived}>
            {t("ct.issue")}
          </Button>
        </div>
      </div>

      {archived ? <Notice tone="warn">{t("ct.archived_note")}</Notice> : null}

      {current?.failed ? (
        <LoadFailure message={t("ct.load_failed")} onRetry={() => void reload()} retrying={refreshing} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <PlanCard plan={plan} loading={loading} archived={archived} onIssue={() => setIssueOpen(true)} />
          </div>
          <div className="lg:col-span-2">
            <SettingsCard settings={settings} loading={loading} eventId={activeEventId} />
          </div>
        </div>
      )}

      {!current?.failed ? (
        <section aria-labelledby="ct-list-h" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="ct-list-h" className="text-[18px] font-semibold" style={{ color: "var(--ink)" }}>{t("ct.list_title")}</h2>
              <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
                {fill(t("ct.list_counts"), { valid: valid.length, revoked: certs.length - valid.length, unsent })}
              </p>
            </div>
            {unsent > 0 ? (
              <Button size="sm" icon={<Send size={13} />} onClick={() => void resend(null)}>{fill(t("ct.send_unsent"), { n: unsent })}</Button>
            ) : null}
          </div>
          <DataTable
            rows={certs}
            columns={columns}
            facets={facets}
            loading={loading}
            searchPlaceholder={t("ct.search")}
            emptyTitle={t("ct.empty")}
            emptyBody={t("ct.empty_hint")}
            pageSize={25}
            labels={tableLabels(t)}
            bulkActions={[{ id: "mail", label: t("ct.resend_selected"), onRun: (ids) => void resend(ids.map(Number)) }]}
          />
        </section>
      ) : null}

      {issueOpen && plan ? (
        <IssueModal plan={plan} busy={busy} onClose={() => setIssueOpen(false)} onIssue={(kinds, email) => void issue(kinds, email)} />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm ? fill(t(confirm.kind === "revoke" ? "ct.revoke_t" : "ct.restore_t"), { name: confirm.cert.name }) : ""}
        message={confirm ? t(confirm.kind === "revoke" ? "ct.revoke_b" : "ct.restore_b") : ""}
        confirmLabel={confirm ? t(confirm.kind === "revoke" ? "ct.revoke" : "ct.restore") : ""}
        cancelLabel={t("ct.keep")}
        variant={confirm?.kind === "revoke" ? "danger" : "default"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void setRevoked(c.cert, c.kind === "revoke"); }}
      />
    </div>
  );
}

/* ── Who gets which ──────────────────────────────────────────────────────── */

function PlanCard({ plan, loading, archived, onIssue }: { plan: CertificatePlan | null; loading: boolean; archived: boolean; onIssue: () => void }) {
  const { t } = useTranslation();
  if (loading || !plan) {
    return (
      <Card className="h-full">
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      </Card>
    );
  }
  const shown = CERT_KINDS.filter((k) => plan.kinds.includes(k) || plan.byKind[k]);
  return (
    <Card className="h-full">
      <CardHeader
        title={t("ct.plan_title")}
        hint={plan.toIssue ? fill(t("ct.plan_to_issue"), { n: plan.toIssue }) : t("ct.plan_all_issued")}
        action={plan.toIssue > 0 && !archived ? <Button size="sm" variant="primary" icon={<Award size={13} />} onClick={onIssue}>{fill(t("ct.issue_n"), { n: plan.toIssue })}</Button> : undefined}
      />
      {shown.length === 0 ? (
        <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("ct.plan_no_kinds")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((k) => {
            const c = plan.byKind[k];
            const waits = (k === "winner" || k === "special") && plan.needsResults;
            return (
              <li key={k} className="rounded-[var(--radius-sm)] border px-3.5 py-3" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
                <p className="flex items-center gap-2 text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                  <span style={{ color: "var(--ink-3)" }}><KindIcon kind={k} size={14} /></span>
                  {t(`ct.kind.${k}`)}
                </p>
                {waits ? (
                  <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--warn)" }}>{t("ct.plan_waits")}</p>
                ) : (
                  <p className="mt-1.5 text-[12.5px] tabular-nums" style={{ color: "var(--ink-2)" }}>
                    {fill(t("ct.plan_counts"), { total: c?.total ?? 0, n: c?.new ?? 0 })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {plan.needsResults ? (
        <div className="mt-4">
          <Notice tone="info" icon={<Trophy size={15} />}>
            {t("ct.needs_results")}{" "}
            <Link href="/results" className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>{t("ct.to_results")}</Link>
          </Notice>
        </div>
      ) : null}
    </Card>
  );
}

/* ── What the builder says ───────────────────────────────────────────────── */

function SettingsCard({ settings, loading, eventId }: { settings: Settings | null; loading: boolean; eventId: number | null }) {
  const { t } = useTranslation();
  const edit = eventId != null ? (
    <Link href={`/create-event/${eventId}?section=certificates`} {...buttonLook("ghost", "sm")}>
      <Pencil size={13} aria-hidden="true" /> {t("ct.edit_settings")}
    </Link>
  ) : undefined;
  if (loading) {
    return (
      <Card className="h-full">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-2 h-14 w-full" />
      </Card>
    );
  }
  return (
    <Card className="h-full">
      <CardHeader title={t("ct.settings_title")} hint={t("ct.settings_hint")} action={edit} />
      {!settings ? (
        <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("ct.settings_unavailable")}</p>
      ) : (
        <dl className="space-y-3 text-[13.5px]">
          <div>
            <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("ct.settings_kinds")}</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {settings.kinds.length
                ? settings.kinds.map((k) => <Badge key={k} tone={KIND_TONE[k]}>{t(`ct.kind.${k}`)}</Badge>)
                : <span style={{ color: "var(--ink-3)" }}>{t("ct.settings_no_kinds")}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("ct.settings_signer")}</dt>
            <dd className="mt-1" style={{ color: settings.signerName ? "var(--ink)" : "var(--ink-3)" }}>
              {settings.signerName ? [settings.signerName, settings.signerTitle].filter(Boolean).join(" · ") : t("ct.settings_no_signer")}
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("ct.settings_signature")}</dt>
            <dd className="mt-1.5">
              {settings.signatureFileId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${settings.signatureFileId}`} alt={t("ct.settings_signature_alt")} className="max-h-14 max-w-[220px] rounded-md border bg-white object-contain p-1" style={{ borderColor: "var(--line)" }} />
              ) : <span style={{ color: "var(--ink-3)" }}>{t("ct.settings_no_signature")}</span>}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: "var(--ink-2)" }}>{t("ct.settings_after_results")}</dt>
            <dd>{settings.issueAfterResults ? <Badge tone="ok">{t("ct.on")}</Badge> : <Badge>{t("ct.off")}</Badge>}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

/* ── Issuing ─────────────────────────────────────────────────────────────── */

function IssueModal({ plan, busy, onClose, onIssue }: { plan: CertificatePlan; busy: boolean; onClose: () => void; onIssue: (kinds: CertKind[] | null, email: boolean) => void }) {
  const { t } = useTranslation();
  const available = CERT_KINDS.filter((k) => plan.kinds.includes(k));
  const ready = (k: CertKind) => !((k === "winner" || k === "special") && plan.needsResults);
  const [chosen, setChosen] = useState<CertKind[]>(() => available.filter(ready));
  const [email, setEmail] = useState(true);
  const count = chosen.reduce((s, k) => s + (plan.byKind[k]?.new ?? 0), 0);
  const toggle = (k: CertKind, on: boolean) => setChosen((cur) => (on ? [...cur, k] : cur.filter((x) => x !== k)));
  const all = chosen.length === available.length;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("ct.issue_title")}
      description={t("ct.issue_hint")}
      footer={(
        <>
          <Button size="sm" onClick={onClose}>{t("Cancel")}</Button>
          <Button size="sm" variant="primary" icon={<Award size={13} />} loading={busy} disabled={busy || chosen.length === 0}
            onClick={() => onIssue(all ? null : chosen, email)}>
            {count ? fill(t("ct.issue_n"), { n: count }) : t("ct.issue")}
          </Button>
        </>
      )}
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("ct.issue_kinds")}</legend>
        {available.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("ct.plan_no_kinds")}</p> : null}
        {available.map((k) => {
          const c = plan.byKind[k];
          const ok = ready(k);
          return (
            <label key={k} className="flex items-start gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5" style={{ borderColor: "var(--line)", opacity: ok ? 1 : 0.6 }}>
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent-solid)]" checked={chosen.includes(k)} disabled={!ok}
                onChange={(e) => toggle(k, e.target.checked)} />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>{t(`ct.kind.${k}`)}</span>
                <span className="block text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                  {ok ? fill(t("ct.plan_counts"), { total: c?.total ?? 0, n: c?.new ?? 0 }) : t("ct.plan_waits")}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <Toggle label={t("ct.issue_email")} help={t("ct.issue_email_hint")} checked={email} onChange={setEmail} />
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
        <ExternalLink size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        {t("ct.issue_once")}
      </p>
    </Modal>
  );
}

