"use client";

/**
 * The projects handed in: each team's project with its track, links and
 * files, and how far judging has got (worked out by the API from the
 * judges' scores). The list refreshes itself every 30 seconds while the tab
 * is open; a project can be opened for its full description or removed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileText, GitBranch, Presentation, RefreshCw, Trash2, Video } from "lucide-react";
import { DataTable, type Column, type Facet } from "@/components/ds/DataTable";
import { Badge, Button, type Tone } from "@/components/ds/primitives";
import { Drawer } from "@/components/ds/overlays";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, DemoReadOnlyError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { RepoCheckBadge, RepoCheckDetails, normalizeRepoChecks, repoSortValue, type RepoChecks } from "@/components/judging/RepoCheck";
import { downloadCSV, toCSV } from "@/lib/csvExport";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import { tableLabels } from "@/lib/i18n/tableLabels";
import { useEventZone } from "@/lib/useEventZone";
import { SUBMISSION_STATUSES, type SubmissionStatus } from "@/lib/results";

const POLL_MS = 30_000;

type Status = SubmissionStatus;
const STATUS_TONE: Record<Status, Tone> = { submitted: "warn", reviewing: "info", graded: "ok" };

interface Row {
  id: number;
  project: string;
  team: string;
  description: string;
  techStack: string;
  repo: string;
  demo: string;
  slides: string;
  video: string;
  files: { id: string; filename: string }[];
  trackId: number | null;
  status: Status;
  submittedAt: string | null;
  updatedAt: string | null;
  scored: number;
  judges: number;
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function normalize(raw: unknown): Row | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Obj;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  const s = str(o.status).toLowerCase();
  return {
    id,
    project: str(o.project_name) || "—",
    team: str(o.team_name) || "—",
    description: str(o.description),
    techStack: str(o.tech_stack),
    repo: str(o.repo_link),
    demo: str(o.demo_link),
    slides: str(o.presentation_link),
    video: str(o.video_link),
    files: Array.isArray(o.files)
      ? o.files.map((f) => f as Obj).filter((f) => f && typeof f.id === "string").map((f) => ({ id: String(f.id), filename: str(f.filename) || "file" }))
      : [],
    trackId: o.track_id == null || o.track_id === "" ? null : Number(o.track_id),
    status: (SUBMISSION_STATUSES as readonly string[]).includes(s) ? (s as Status) : "submitted",
    submittedAt: str(o.submitted_at) || null,
    updatedAt: str(o.updated_at) || null,
    scored: Number(o.scored_judges) || 0,
    judges: Number(o.assigned_judges) || 0,
  };
}

const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

export default function SubmissionsPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const { timeZone } = useEventZone(activeEventId);
  const [rows, setRows] = useState<Row[]>([]);
  const [tracks, setTracks] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [repo, setRepo] = useState<RepoChecks>({ enabled: false, bySubmission: new Map() });
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (activeEventId == null) return;
    try {
      const [subs, tr, rc] = await Promise.all([
        apiGet<unknown[]>(`/api/submissions?eventId=${activeEventId}`),
        apiGet<unknown[]>(`/api/events/${activeEventId}/tracks`).catch(() => []),
        apiGet<unknown>(`/api/events/${activeEventId}/judging/repo-checks`).catch(() => null),
      ]);
      if (rc) setRepo(normalizeRepoChecks(rc));
      setRows((Array.isArray(subs) ? subs : []).map(normalize).filter((r): r is Row => r != null));
      const names = new Map<number, string>();
      for (const x of Array.isArray(tr) ? tr : []) {
        const o = x as Obj;
        if (Number.isFinite(Number(o.id)) && str(o.name)) names.set(Number(o.id), str(o.name));
      }
      setTracks(names);
      setUpdated(new Date());
      setFailed(false);
    } catch {
      // A background refresh that fails keeps what is on screen; only an empty screen says why.
      if (!quiet) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    if (eventLoading || activeEventId == null) return;
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(true); }, POLL_MS);
    return () => clearInterval(timer);
  }, [activeEventId, eventLoading, load]);

  const checkRepos = async () => {
    if (activeEventId == null) return;
    setChecking(true);
    try {
      const out = await apiPost<{ queued?: number }>(`/api/events/${activeEventId}/judging/repo-checks`, {});
      const n = Number(out?.queued) || 0;
      toast(n ? fill(t("sb.gh_queued"), { n }) : t("sb.gh_none_github"), n ? "success" : "info");
      // The checks run in the background; look again once they have had time.
      if (n) setTimeout(() => void load(true), 6000);
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(err instanceof ApiError && err.summary ? err.summary : t("sb.gh_failed"), "error");
    } finally {
      setChecking(false);
    }
  };

  const remove = async (row: Row) => {
    try {
      await apiDelete(`/api/submissions/${row.id}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setOpenId(null);
      toast(fill(t("sb.deleted"), { project: row.project }), "success");
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) {
        toast(err instanceof ApiError && err.code === "RESULTS_PUBLISHED" ? t("sb.err.RESULTS_PUBLISHED")
          : err instanceof ApiError && err.summary ? err.summary : t("sb.delete_failed"), "error");
      }
    }
  };

  const when = useCallback((iso: string | null) => (iso ? formatDate(iso, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }) : "—"), [lang, timeZone]);
  const trackOf = useCallback((r: Row) => (r.trackId != null ? tracks.get(r.trackId) ?? "" : ""), [tracks]);

  const exportCsv = () => {
    const csv = toCSV(rows.map((r) => ({
      team: r.team, project: r.project, track: trackOf(r), status: t(`sb.status.${r.status}`), submitted: when(r.submittedAt),
      repo: r.repo, demo: r.demo, slides: r.slides, video: r.video, judges: `${r.scored}/${r.judges}`,
    })), [
      { key: "team", header: t("sb.col.team") },
      { key: "project", header: t("sb.col.project") },
      { key: "track", header: t("sb.col.track") },
      { key: "status", header: t("sb.col.status") },
      { key: "submitted", header: t("sb.col.submitted") },
      { key: "repo", header: t("sb.repo") },
      { key: "demo", header: t("sb.demo") },
      { key: "slides", header: t("sb.slides") },
      { key: "video", header: t("sb.video") },
      { key: "judges", header: t("sb.col.judges") },
    ]);
    downloadCSV("submissions.csv", csv);
  };

  const columns: Column<Row>[] = [
    {
      id: "project", header: t("sb.col.project"), sortable: true,
      value: (r) => `${r.project} ${r.team}`,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{r.project}</p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{r.team}</p>
        </div>
      ),
    },
    {
      id: "track", header: t("sb.col.track"), sortable: true, value: (r) => trackOf(r),
      cell: (r) => (trackOf(r) ? <span style={{ color: "var(--ink-2)" }}>{trackOf(r)}</span> : <span style={{ color: "var(--ink-3)" }}>—</span>),
    },
    {
      id: "status", header: t("sb.col.status"), sortable: true, value: (r) => SUBMISSION_STATUSES.indexOf(r.status),
      cell: (r) => (
        <span className="inline-flex flex-col items-start gap-0.5">
          <Badge tone={STATUS_TONE[r.status]} dot>{t(`sb.status.${r.status}`)}</Badge>
          {r.judges > 0 ? <span className="text-[11.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>{fill(t("sb.judged"), { n: r.scored, total: r.judges })}</span> : null}
        </span>
      ),
    },
    {
      id: "submitted", header: t("sb.col.submitted"), sortable: true, value: (r) => r.submittedAt ?? "",
      cell: (r) => <span className="tabular-nums text-[13px]" style={{ color: "var(--ink-2)" }}>{when(r.submittedAt)}</span>,
    },
    {
      id: "links", header: t("sb.col.links"), value: () => "", hideOnCard: false,
      cell: (r) => <Links row={r} />,
    },
    {
      id: "github", header: t("sb.col.github"), sortable: true, value: (r) => repoSortValue(repo.bySubmission.get(r.id)),
      cell: (r) => <RepoCheckBadge item={repo.bySubmission.get(r.id)} />,
    },
    {
      id: "actions", header: "", value: () => "", align: "right",
      cell: (r) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={fill(t("sb.delete_n"), { project: r.project })} title={t("sb.delete")} style={{ color: "var(--danger)" }} onClick={() => setToDelete(r)} />
        </div>
      ),
    },
  ];

  const facets: Facet<Row>[] = useMemo(() => {
    const out: Facet<Row>[] = [{
      id: "status", label: t("sb.col.status"),
      options: SUBMISSION_STATUSES.map((s) => ({ value: s, label: t(`sb.status.${s}`) })),
      match: (r, sel) => sel.includes(r.status),
    }];
    if (tracks.size) {
      out.push({
        id: "track", label: t("sb.col.track"),
        options: [...tracks.entries()].map(([id, name]) => ({ value: String(id), label: name })),
        match: (r, sel) => r.trackId != null && sel.includes(String(r.trackId)),
      });
    }
    return out;
  }, [tracks, t]);

  const open = rows.find((r) => r.id === openId) ?? null;
  const counts = SUBMISSION_STATUSES.map((s) => rows.filter((r) => r.status === s).length);

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("rs.no_event")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("sb.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("sb.subtitle")}</p>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ok)" }} aria-hidden="true" />
            {updated ? fill(t("sb.updated"), { time: formatDate(updated, lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) }) : t("sb.auto")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load(true)}>{t("sb.refresh")}</Button>
          <Button size="sm" variant="secondary" icon={<GitBranch size={14} />} loading={checking} disabled={checking || rows.length === 0} onClick={() => void checkRepos()}>{t("sb.gh_check")}</Button>
          <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={exportCsv} disabled={rows.length === 0}>{t("sb.export")}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {[
          { label: t("sb.stat.total"), value: rows.length },
          ...SUBMISSION_STATUSES.map((s, i) => ({ label: t(`sb.status.${s}`), value: counts[i] })),
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
            <p className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{s.value}</p>
          </div>
        ))}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        facets={facets}
        loading={loading || eventLoading}
        error={failed && rows.length === 0}
        onRetry={() => { setLoading(true); void load(); }}
        searchPlaceholder={t("sb.search")}
        emptyTitle={t("sb.empty")}
        emptyBody={t("sb.empty_hint")}
        onRowClick={(r) => setOpenId(r.id)}
        pageSize={25}
        labels={tableLabels(t)}
      />

      {open ? (
        <Drawer open onClose={() => setOpenId(null)} title={open.project} description={open.team}
          footer={
            <div className="flex w-full justify-between gap-2">
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} style={{ color: "var(--danger)" }} onClick={() => setToDelete(open)}>{t("sb.delete")}</Button>
              <Button size="sm" variant="secondary" onClick={() => setOpenId(null)}>{t("sb.close")}</Button>
            </div>
          }>
          <div className="space-y-5 text-[13.5px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[open.status]} dot>{t(`sb.status.${open.status}`)}</Badge>
              {open.judges > 0 ? <span style={{ color: "var(--ink-2)" }}>{fill(t("sb.judged"), { n: open.scored, total: open.judges })}</span> : null}
              {trackOf(open) ? <Badge tone="info">{trackOf(open)}</Badge> : null}
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              <dt style={{ color: "var(--ink-3)" }}>{t("sb.col.submitted")}</dt><dd style={{ color: "var(--ink)" }}>{when(open.submittedAt)}</dd>
              <dt style={{ color: "var(--ink-3)" }}>{t("sb.changed")}</dt><dd style={{ color: "var(--ink)" }}>{when(open.updatedAt)}</dd>
              {open.techStack ? <><dt style={{ color: "var(--ink-3)" }}>{t("sb.stack")}</dt><dd style={{ color: "var(--ink)" }}>{open.techStack}</dd></> : null}
            </dl>
            <section>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("sb.description")}</h3>
              <p className="whitespace-pre-line leading-relaxed" style={{ color: "var(--ink)" }}>{open.description || t("sb.no_description")}</p>
            </section>
            <section>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("sb.col.links")}</h3>
              <Links row={open} />
            </section>
            <section>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("sb.gh_title")}</h3>
              <RepoCheckDetails item={repo.bySubmission.get(open.id)} timeZone={timeZone} />
            </section>
          </div>
        </Drawer>
      ) : null}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={toDelete ? fill(t("sb.delete_t"), { project: toDelete.project }) : ""}
        message={t("sb.delete_b")}
        confirmLabel={t("sb.delete")}
        cancelLabel={t("rs.cancel")}
        variant="danger"
        onCancel={() => setToDelete(null)}
        onConfirm={() => { const r = toDelete; setToDelete(null); if (r) void remove(r); }}
      />
    </div>
  );
}

function Links({ row }: { row: Row }) {
  const { t } = useTranslation();
  const link = "inline-flex max-w-[12rem] items-center gap-1 rounded-md px-2 py-1 text-[12px]";
  const style = { background: "var(--tint)", color: "var(--ink-2)" } as const;
  const items = [
    row.repo ? <a key="repo" href={href(row.repo)} target="_blank" rel="noopener noreferrer" className={link} style={style}><ExternalLink size={12} aria-hidden="true" />{t("sb.repo")}</a> : null,
    row.demo ? <a key="demo" href={href(row.demo)} target="_blank" rel="noopener noreferrer" className={link} style={style}><ExternalLink size={12} aria-hidden="true" />{t("sb.demo")}</a> : null,
    row.slides ? <a key="slides" href={href(row.slides)} target="_blank" rel="noopener noreferrer" className={link} style={style}><Presentation size={12} aria-hidden="true" />{t("sb.slides")}</a> : null,
    row.video ? <a key="video" href={href(row.video)} target="_blank" rel="noopener noreferrer" className={link} style={style}><Video size={12} aria-hidden="true" />{t("sb.video")}</a> : null,
    ...row.files.map((f) => (
      <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer" className={link} style={style} title={f.filename}>
        <FileText size={12} aria-hidden="true" /><span className="truncate">{f.filename}</span>
      </a>
    )),
  ].filter(Boolean);
  if (!items.length) return <span style={{ color: "var(--ink-3)" }}>—</span>;
  return <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>{items}</div>;
}
