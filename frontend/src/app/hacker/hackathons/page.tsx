"use client";

/**
 * My hackathons: every event the participant took part in — their role,
 * team, project, place and prizes, as far as each organiser let them see —
 * their certificates, and the switches of their public profile
 * (/u/<handle>), which stays off until they turn it on and then shows only
 * what they tick.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award, CalendarDays, Check, Copy, ExternalLink, EyeOff, FolderGit2, Globe2, Medal, Search, Trophy, Users,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, Skeleton, buttonLook, type Tone } from "@/components/ds/primitives";
import { Notice, TextInput, Toggle } from "@/components/builder/ui";
import { LoadFailure } from "@/components/LoadFailure";
import { MyCertificates } from "@/components/wrapup/MyCertificates";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiGet, apiPut } from "@/lib/api";
import { ordinal } from "@/lib/certificates";
import { fill } from "@/lib/i18n/fill";
import { siteOrigin } from "@/lib/hosts";
import {
  HEADLINE_MAX, byDateDesc, cleanHandle, eventDatesOf, isHandle, normalizeMyHackathons, normalizeSettings, summaryOf,
  type MyCertificateRow, type MyHackathon, type ProfileSettings,
} from "@/lib/profile";

type Loaded = { events: MyHackathon[]; certificates: MyCertificateRow[] };

const STATUS_TONE: Record<string, Tone> = { pending: "warn", waitlisted: "info", eliminated: "neutral" };

export default function MyHackathonsPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<Loaded | "failed" | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(normalizeMyHackathons(await apiGet<unknown>("/api/me/hackathons")));
    } catch {
      setData("failed");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read of the page
    void load();
  }, [load]);

  const events = useMemo(() => (data && data !== "failed" ? byDateDesc(data.events) : []), [data]);
  const counts = data && data !== "failed" ? summaryOf(data.events, data.certificates) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.02em] sm:text-[28px]" style={{ color: "var(--ink)" }}>{t("pf.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("pf.subtitle")}</p>
      </div>

      {data === "failed" ? (
        <LoadFailure message={t("pf.load_failed")} retrying={retrying} onRetry={() => { setRetrying(true); void load().finally(() => setRetrying(false)); }} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([
              ["events", Trophy], ["projects", FolderGit2], ["prizes", Medal], ["certificates", Award],
            ] as const).map(([k, Icon]) => (
              <Card key={k} className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  {counts ? (
                    <p className="text-[22px] font-semibold leading-none tabular-nums" style={{ color: "var(--ink)" }}>{counts[k]}</p>
                  ) : <Skeleton className="h-5 w-8" />}
                  <p className="mt-1 truncate text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t(`pf.stat.${k}`)}</p>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-6">
              <section aria-labelledby="pf-events-h" className="space-y-3">
                <h2 id="pf-events-h" className="text-[17px] font-semibold" style={{ color: "var(--ink)" }}>{t("pf.events")}</h2>
                {data === null ? (
                  <div className="space-y-3">{[0, 1].map((i) => <Card key={i}><Skeleton className="h-5 w-56" /><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-2 h-4 w-2/3" /></Card>)}</div>
                ) : events.length === 0 ? (
                  <Card className="py-10 text-center">
                    <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("pf.empty_title")}</p>
                    <p className="mx-auto mt-1 max-w-sm text-[13.5px]" style={{ color: "var(--ink-2)" }}>{t("pf.empty_body")}</p>
                    <div className="mt-4"><a href="/hackathons" {...buttonLook("secondary", "sm")}>{t("pf.browse")}</a></div>
                  </Card>
                ) : (
                  <ul className="space-y-3">
                    {events.map((e) => <li key={`${e.event.id}-${e.role}`}><EventRow row={e} /></li>)}
                  </ul>
                )}
              </section>

              <section aria-labelledby="pf-certs-h" className="space-y-3">
                <h2 id="pf-certs-h" className="sr-only">{t("pf.certs")}</h2>
                {data && data.certificates.length ? (
                  <MyCertificates title={t("pf.certs")} />
                ) : data ? (
                  <Card>
                    <CardHeader title={t("pf.certs")} hint={t("pf.certs_empty")} className="mb-0" />
                  </Card>
                ) : null}
              </section>
            </div>

            <aside className="min-w-0">
              <div className="lg:sticky lg:top-4">
                <PublicProfileCard events={events} />
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/* ── One event ──────────────────────────────────────────────────────────── */

function EventRow({ row }: { row: MyHackathon }) {
  const { t, lang } = useTranslation();
  const dates = eventDatesOf(row.event, lang);
  const isTeam = ["lead", "member", "solo"].includes(row.role);
  const r = row.result;
  const place = r.place ? (r.of ? fill(t("pf.place_of"), { place: ordinal(lang, r.place), of: r.of }) : fill(t("pf.place"), { place: ordinal(lang, r.place) })) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>{row.event.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
            {dates ? <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} aria-hidden="true" />{dates}</span> : null}
            {row.event.organiser ? <span>{row.event.organiser}</span> : null}
            {!row.event.slug && row.shareable === false && row.status === "approved" ? <span>{t("pf.private_event")}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={isTeam ? "brand" : "info"}>{t(`pf.role.${row.role}`)}</Badge>
          {STATUS_TONE[row.status] ? <Badge tone={STATUS_TONE[row.status]} dot>{t(`pf.status.${row.status}`)}</Badge> : null}
        </div>
      </div>

      {isTeam && (row.team || row.project || r.published) ? (
        <dl className="mt-4 grid gap-3 rounded-[var(--radius-sm)] border p-3.5 text-[13.5px] sm:grid-cols-3" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{t("pf.team")}</dt>
            <dd className="mt-1 flex items-center gap-1.5 truncate" style={{ color: "var(--ink)" }}><Users size={13} aria-hidden="true" style={{ color: "var(--ink-3)" }} />{row.team || "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{t("pf.project")}</dt>
            <dd className="mt-1 truncate" style={{ color: "var(--ink)" }}>{row.project?.name || "—"}</dd>
            {row.project?.tech ? <dd className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>{row.project.tech}</dd> : null}
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{t("pf.result")}</dt>
            <dd className="mt-1" style={{ color: "var(--ink)" }}>
              {!r.published ? <span style={{ color: "var(--ink-3)" }}>{t("pf.results_pending")}</span> : place ?? <span style={{ color: "var(--ink-3)" }}>{t("pf.results_none")}</span>}
            </dd>
            {r.prizes.map((p) => (
              <dd key={p.name} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium" style={{ color: "var(--warn)" }}>
                <Medal size={13} aria-hidden="true" />{p.name}{p.value ? ` · ${p.value}` : ""}
              </dd>
            ))}
          </div>
        </dl>
      ) : null}

      {row.event.slug || row.project?.publicUrl ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {row.event.slug ? (
            <a href={`/e/${row.event.slug}`} target="_blank" rel="noopener noreferrer" {...buttonLook("ghost", "sm")}>
              <ExternalLink size={13} aria-hidden="true" /> {t("pf.open_event")}
            </a>
          ) : null}
          {row.project?.publicUrl ? (
            <a href={row.project.publicUrl} target="_blank" rel="noopener noreferrer" {...buttonLook("ghost", "sm")}>
              <Trophy size={13} aria-hidden="true" /> {t("pf.open_projects")}
            </a>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/* ── The public profile's switches ──────────────────────────────────────── */

const PARTS = ["showName", "showEvents", "showProjects", "showCertificates"] as const;
const PART_KEY: Record<(typeof PARTS)[number], string> = {
  showName: "pf.public.show_name", showEvents: "pf.public.show_events", showProjects: "pf.public.show_projects", showCertificates: "pf.public.show_certificates",
};

function PublicProfileCard({ events }: { events: MyHackathon[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [saved, setSaved] = useState<ProfileSettings | null>(null);
  const [draft, setDraft] = useState<ProfileSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<unknown>("/api/me/public-profile").then(
      (raw) => {
        if (cancelled) return;
        const s = normalizeSettings(raw);
        setSaved(s);
        setDraft({ ...s, handle: s.handle ?? s.suggestedHandle });
      },
      () => { if (!cancelled) setFailed(true); },
    );
    return () => { cancelled = true; };
  }, []);

  const shareable = events.filter((e) => e.shareable && e.event.id != null);
  const url = saved?.path ? `${siteOrigin()}${saved.path}` : null;
  const dirty = Boolean(saved && draft && JSON.stringify({ ...saved, handle: saved.handle ?? saved.suggestedHandle }) !== JSON.stringify(draft));
  const nothingTicked = draft ? !PARTS.some((k) => draft[k]) : false;

  const update = (patch: Partial<ProfileSettings>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!draft) return;
    const handle = (draft.handle || "").replace(/^-+|-+$/g, "");
    if (!isHandle(handle)) {
      setHandleError(t("pf.err.handle"));
      return;
    }
    setBusy(true);
    setHandleError(null);
    try {
      const out = normalizeSettings(await apiPut<unknown>("/api/me/public-profile", {
        enabled: draft.enabled, indexable: draft.enabled && draft.indexable, handle, headline: draft.headline ?? "",
        showName: draft.showName, showEvents: draft.showEvents, showProjects: draft.showProjects, showCertificates: draft.showCertificates,
        hiddenEventIds: draft.hiddenEventIds,
      }));
      setSaved(out);
      setDraft({ ...out, handle: out.handle ?? handle });
      toast(t("pf.public.saved"), "success");
    } catch (err) {
      if (err instanceof ApiError && err.code === "HANDLE_TAKEN") setHandleError(t("pf.err.HANDLE_TAKEN"));
      else if (err instanceof ApiError && /reserved/i.test(err.message)) setHandleError(t("pf.err.reserved"));
      else if (err instanceof ApiError && err.code === "VALIDATION_ERROR" && /handle/i.test(JSON.stringify(err.fieldErrors ?? ""))) setHandleError(t("pf.err.handle"));
      else toast(t("pf.err.generic"), "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast(t("pf.public.copied"), "success");
    } catch {
      toast(url, "info", 12000);
    }
  };

  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><Globe2 size={15} aria-hidden="true" />{t("pf.public.title")}</span>} hint={t("pf.public.help")} />
      {failed ? (
        <p className="text-[13px]" style={{ color: "var(--danger)" }}>{t("pf.err.generic")}</p>
      ) : !draft ? (
        <div className="space-y-3"><Skeleton className="h-6 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (
        <div className="space-y-4">
          <Toggle
            label={t("pf.public.on")}
            help={t("pf.public.on_help")}
            checked={draft.enabled}
            onChange={(v) => update(v && !saved?.enabled && !PARTS.some((k) => draft[k])
              // A first switch-on suggests the name and the hackathons; nothing is shown until Save.
              ? { enabled: true, showName: true, showEvents: true }
              // Off takes being found by search engines with it.
              : v ? { enabled: true } : { enabled: false, indexable: false })}
          />
          <Toggle
            label={t("pf.public.indexable")}
            help={draft.enabled ? t("pf.public.indexable_help") : t("pf.public.indexable_needs_on")}
            checked={draft.enabled && draft.indexable}
            disabled={!draft.enabled}
            onChange={(v) => update({ indexable: v })}
          />
          <TextInput
            label={t("pf.public.address")}
            prefix="/u/"
            value={draft.handle ?? ""}
            maxLength={30}
            error={handleError}
            help={t("pf.public.handle_help")}
            onChange={(v) => { setHandleError(null); update({ handle: cleanHandle(v) }); }}
          />
          <TextInput
            label={t("pf.public.headline")}
            value={draft.headline ?? ""}
            maxLength={HEADLINE_MAX}
            placeholder={t("pf.public.headline_ph")}
            onChange={(v) => update({ headline: v })}
          />
          <fieldset className="space-y-1">
            <legend className="mb-1 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("pf.public.show")}</legend>
            {PARTS.map((k) => (
              <Check2 key={k} checked={draft[k]} onChange={(v) => update({ [k]: v } as Partial<ProfileSettings>)}>{t(PART_KEY[k])}</Check2>
            ))}
          </fieldset>
          {shareable.length && (draft.showEvents || draft.showProjects || draft.showCertificates) ? (
            <fieldset className="space-y-1">
              <legend className="mb-0.5 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("pf.public.hidden")}</legend>
              <p className="mb-1 text-[12px]" style={{ color: "var(--ink-3)" }}>{t("pf.public.hidden_help")}</p>
              {shareable.map((e) => {
                const id = e.event.id as number;
                const shown = !draft.hiddenEventIds.includes(id);
                return (
                  <Check2 key={id} checked={shown}
                    onChange={(v) => update({ hiddenEventIds: v ? draft.hiddenEventIds.filter((x) => x !== id) : [...draft.hiddenEventIds, id] })}>
                    {e.event.name}
                  </Check2>
                );
              })}
            </fieldset>
          ) : null}
          {draft.enabled && nothingTicked ? <Notice tone="warn">{t("pf.public.nothing")}</Notice> : null}
          {!saved?.enabled ? <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("pf.public.off_note")}</p> : null}
          <div className="flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
            <Button variant="primary" size="sm" onClick={() => void save()} loading={busy} disabled={busy || !dirty}>{t("pf.public.save")}</Button>
            {url ? (
              <>
                <a href={url} target="_blank" rel="noopener noreferrer" {...buttonLook("secondary", "sm")}><ExternalLink size={13} aria-hidden="true" /> {t("pf.public.view")}</a>
                <Button variant="ghost" size="sm" icon={<Copy size={13} />} onClick={() => void copy()}>{t("pf.public.copy")}</Button>
              </>
            ) : null}
          </div>
          {url ? <p className="truncate font-mono text-[12px]" style={{ color: "var(--ink-3)" }}>{url.replace(/^https?:\/\//, "")}</p> : null}
          {saved?.enabled ? (
            <p className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
              {saved.indexable ? <Search size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
              {t(saved.indexable ? "pf.public.indexable_on" : "pf.public.indexable_off")}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function Check2({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-sm)] px-1 py-1.5 text-[13.5px] hover:bg-[var(--tint)]" style={{ color: "var(--ink)" }}>
      <span className="relative mt-[1px] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border"
        style={{ borderColor: checked ? "var(--accent-solid)" : "var(--line-strong)", background: checked ? "var(--accent-solid)" : "var(--surface)" }}>
        <input type="checkbox" className="absolute inset-0 cursor-pointer opacity-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {checked ? <Check size={13} color="#fff" aria-hidden="true" /> : null}
      </span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

