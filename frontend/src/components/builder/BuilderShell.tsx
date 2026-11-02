"use client";

/**
 * The frame of the event builder: a top bar (name, state, saving, preview,
 * publish), the twenty sections down the side with their state, the
 * section itself, and the publish checklist. On a phone the sections become
 * a picker above the content and the checklist a panel.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Circle, CloudOff, ExternalLink, Eye, LayoutDashboard, Loader2, Lock, Rocket, Share2,
  TriangleAlert, Users,
} from "lucide-react";
import { Badge, Button, buttonLook, cx } from "@/components/ds/primitives";
import { checklistField, checklistText, fieldId } from "@/lib/builder/checklist";
import { isEventPhase, phaseLabelKey } from "@/lib/eventPhase";
import { isLivePhase, phaseTone } from "@/lib/eventOverview";
import { Drawer, Modal } from "@/components/ds/overlays";
import { ApiError } from "@/lib/api";
import { SECTIONS, sectionState, type SectionState } from "@/lib/builder/sections";
import type { BuilderPayload, ChecklistItem, SectionKey } from "@/lib/builder/types";
import type { SaveStatus } from "@/lib/builder/useBuilder";

const GROUPS = ["basics", "people", "content", "judging", "team", "day", "comms", "finish"] as const;

function StateIcon({ state }: { state: SectionState }) {
  switch (state) {
    case "locked": return <Lock size={14} aria-hidden="true" style={{ color: "var(--ink-3)" }} />;
    case "error": return <AlertCircle size={15} aria-hidden="true" style={{ color: "var(--danger)" }} />;
    case "warning": return <TriangleAlert size={14} aria-hidden="true" style={{ color: "var(--warn)" }} />;
    case "done": return <CheckCircle2 size={15} aria-hidden="true" style={{ color: "var(--ok)" }} />;
    default: return <Circle size={14} aria-hidden="true" style={{ color: "var(--line-strong)" }} />;
  }
}

function SaveIndicator({ status, savedAt, t }: { status: SaveStatus; savedAt: number | null; t: (k: string) => string }) {
  const map: Record<SaveStatus, { icon: ReactNode; text: string; color: string }> = {
    idle: { icon: <CheckCircle2 size={14} />, text: savedAt ? t("b.save.saved") : t("b.save.idle"), color: "var(--ink-3)" },
    pending: { icon: <Loader2 size={14} className="animate-spin" />, text: t("b.save.pending"), color: "var(--ink-3)" },
    saving: { icon: <Loader2 size={14} className="animate-spin" />, text: t("b.save.saving"), color: "var(--ink-3)" },
    saved: { icon: <CheckCircle2 size={14} />, text: t("b.save.saved"), color: "var(--ok)" },
    error: { icon: <AlertCircle size={14} />, text: t("b.save.error"), color: "var(--danger)" },
    offline: { icon: <CloudOff size={14} />, text: t("b.save.offline"), color: "var(--warn)" },
  };
  const m = map[status];
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: m.color }}>
      {m.icon}
      <span className="hidden sm:inline">{m.text}</span>
    </span>
  );
}

export { checklistText };

export function ChecklistList({ items, t, onGo }: { items: ChecklistItem[]; t: (k: string) => string; onGo: (s: SectionKey, field?: string | null) => void }) {
  const errors = items.filter((i) => i.severity === "error");
  const warnings = items.filter((i) => i.severity === "warning");
  const row = (i: ChecklistItem, idx: number) => (
    <li key={`${i.code}-${idx}`}>
      <button type="button" onClick={() => onGo(i.section, checklistField(i))} className="flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[var(--tint)]">
        {i.severity === "error"
          ? <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} aria-hidden="true" />
          : <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} aria-hidden="true" />}
        <span className="min-w-0 flex-1" style={{ color: "var(--ink)" }}>{checklistText(i, t)}</span>
        <span className="shrink-0 text-[11.5px]" style={{ color: "var(--ink-3)" }}>{t(`b.sec.${i.section}`)}</span>
      </button>
    </li>
  );
  return (
    <div className="space-y-4">
      {errors.length ? (
        <div>
          <p className="mb-1 px-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--danger)" }}>{t("b.check.must")}</p>
          <ul>{errors.map(row)}</ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 px-2.5 text-[13px] font-medium" style={{ color: "var(--ok)" }}><CheckCircle2 size={15} /> {t("b.check.ready")}</p>
      )}
      {warnings.length ? (
        <div>
          <p className="mb-1 px-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--warn)" }}>{t("b.check.should")}</p>
          <ul>{warnings.map(row)}</ul>
        </div>
      ) : null}
    </div>
  );
}

/** Once the event is live: what to do next, instead of "before publishing". */
function NextSteps({ ev, t, onShare }: { ev: BuilderPayload["event"]; t: (k: string) => string; onShare: () => void }) {
  const link = buttonLook("secondary", "sm");
  return (
    <div className="rounded-[16px] border p-4" style={{ borderColor: "var(--ok)", background: "var(--ok-weak)" }}>
      <p className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
        <CheckCircle2 size={16} aria-hidden="true" style={{ color: "var(--ok)" }} /> {t("b.next.title")}
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("b.next.body")}</p>
      <div className="mt-3 grid gap-2">
        <Link href="/" className={cx(link.className, "justify-start")} style={link.style}><LayoutDashboard size={14} aria-hidden="true" />{t("b.next.dashboard")}</Link>
        <Link href="/participants" className={cx(link.className, "justify-start")} style={link.style}><Users size={14} aria-hidden="true" />{t("b.next.participants")}</Link>
        <button type="button" onClick={onShare} className={cx(link.className, "justify-start")} style={link.style}><Share2 size={14} aria-hidden="true" />{t("b.next.share")}</button>
        {ev.slug ? (
          <a href={`/e/${ev.slug}`} target="_blank" rel="noreferrer" className={cx(link.className, "justify-start")} style={link.style}><ExternalLink size={14} aria-hidden="true" />{t("b.next.public")}</a>
        ) : null}
      </div>
    </div>
  );
}

export interface ShellProps {
  data: BuilderPayload;
  section: SectionKey;
  onSection: (s: SectionKey) => void;
  status: SaveStatus;
  savedAt: number | null;
  blocked: string | null;
  t: (k: string) => string;
  onPublish: () => Promise<boolean>;
  onUnpublish: () => Promise<void>;
  onPreview: () => void;
  publishError: ApiError | null;
  children: ReactNode;
}

export function BuilderShell({
  data, section, onSection, status, savedAt, blocked, t, onPublish, onUnpublish, onPreview, publishError, children,
}: ShellProps) {
  const ev = data.event;
  const visited = useMemo(() => ev.builder_state?.visited || [], [ev.builder_state]);
  const [checkOpen, setCheckOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const states = useMemo(
    () => Object.fromEntries(SECTIONS.map((s) => [s.key, sectionState(s, data.modules, data.checklist, visited)])) as Record<SectionKey, SectionState>,
    [data.modules, data.checklist, visited],
  );
  const idx = SECTIONS.findIndex((s) => s.key === section);
  const def = SECTIONS[idx];
  const errors = data.checklist.filter((i) => i.severity === "error").length;
  const warnings = data.checklist.length - errors;
  const published = ev.is_published;
  const [focusField, setFocusField] = useState<string | null>(null);
  const go = (s: SectionKey, field?: string | null) => {
    onSection(s);
    setCheckOpen(false);
    setPublishOpen(false);
    setFocusField(field ?? null);
  };

  // A checklist item about one field opens its section and puts the cursor there.
  useEffect(() => {
    if (!focusField) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(fieldId(focusField));
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        (el as HTMLElement).focus({ preventScroll: true });
      }
      setFocusField(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [focusField, section]);

  const doPublish = async () => {
    setBusy(true);
    try {
      if (await onPublish()) setPublishOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const nav = (
    <nav aria-label={t("b.shell.sections")} className="space-y-4">
      {GROUPS.map((g) => (
        <div key={g}>
          <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{t(`b.group.${g}`)}</p>
          <ul>
            {SECTIONS.filter((s) => s.group === g).map((s) => {
              const n = SECTIONS.indexOf(s) + 1;
              const on = s.key === section;
              const Icon = s.icon;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => go(s.key)}
                    aria-current={on ? "step" : undefined}
                    className={cx("flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition-colors", !on && "hover:bg-[var(--tint)]")}
                    style={on ? { background: "var(--accent-weak)", color: "var(--ink)" } : { color: "var(--ink-2)" }}
                  >
                    <span className="w-5 text-right text-[11.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>{n}</span>
                    <Icon size={15} aria-hidden="true" style={{ color: on ? "var(--accent)" : "var(--ink-3)" }} />
                    <span className={cx("min-w-0 flex-1 truncate", on && "font-semibold")}>{t(`b.sec.${s.key}`)}</span>
                    <StateIcon state={states[s.key]} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh" style={{ background: "var(--surface-sunken)" }}>
      <header className="sticky top-0 z-30 border-b backdrop-blur" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface) 96%, transparent)" }}>
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          <Link href={published ? "/" : "/workspaces"} className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[13px] hover:bg-[var(--tint)]" style={{ color: "var(--ink-2)" }}>
            <ArrowLeft size={15} /> <span className="hidden md:inline">{t("b.shell.back")}</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{ev.name}</p>
            <p className="flex items-center gap-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
              {published && isEventPhase(ev.phase) ? (
                // Live: where it is now, in the words the header and the home use.
                <Badge tone={phaseTone(ev.phase)} dot={isLivePhase(ev.phase)}>{t(phaseLabelKey(ev.phase))}</Badge>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium" style={published ? { background: "var(--ok-weak)", color: "var(--ok)" } : { background: "var(--tint)", color: "var(--ink-2)" }}>
                  {published ? t("b.state.published") : ev.published_at ? t("b.state.hidden") : t("ov.phase.draft")}
                </span>
              )}
              <SaveIndicator status={status} savedAt={savedAt} t={t} />
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onPreview}><Eye size={15} /> <span className="hidden sm:inline">{t("b.shell.preview")}</span></Button>
          <button type="button" onClick={() => setCheckOpen(true)} aria-label={t(published ? "b.check.title_live" : "b.check.title")}
            className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium xl:hidden"
            style={{ color: errors ? "var(--danger)" : "var(--ok)", background: errors ? "var(--danger-weak)" : "var(--ok-weak)" }}>
            {errors ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />} {errors ? `${errors}` : t("b.check.short_ready")}
          </button>
          {published ? (
            <Button variant="secondary" size="sm" onClick={() => setPublishOpen(true)}><CheckCircle2 size={15} style={{ color: "var(--ok)" }} /> {t("b.shell.published")}</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setPublishOpen(true)}><Rocket size={15} /> {t("b.shell.publish")}</Button>
          )}
        </div>
        {blocked ? (
          <div className="border-t px-4 py-2 text-center text-[12.5px]" style={{ borderColor: "var(--line)", background: "var(--warn-weak)", color: "var(--ink)" }}>{blocked}</div>
        ) : null}
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:grid-cols-[15.5rem_minmax(0,1fr)_19rem]">
        <aside className="hidden lg:block">
          <div className="sticky top-[84px] max-h-[calc(100dvh-100px)] overflow-y-auto pb-6 pr-1">{nav}</div>
        </aside>

        <main className="min-w-0">
          <div className="mb-4 lg:hidden">
            <label className="sr-only" htmlFor="b-section-pick">{t("b.shell.sections")}</label>
            <div className="relative">
              <select id="b-section-pick" value={section} onChange={(e) => go(e.target.value as SectionKey)}
                className="w-full appearance-none rounded-[12px] border px-4 py-3 pr-10 text-[14px] font-medium" style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}>
                {SECTIONS.map((s, i) => (
                  <option key={s.key} value={s.key}>{`${i + 1}. ${t(`b.sec.${s.key}`)}${states[s.key] === "error" ? " • !" : states[s.key] === "locked" ? " • 🔒" : ""}`}</option>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-3)" }} />
            </div>
          </div>

          <div className="mb-5">
            <p className="text-[12px] font-medium tabular-nums" style={{ color: "var(--ink-3)" }}>{t("b.shell.step")} {idx + 1} / {SECTIONS.length}</p>
            <h1 className="mt-1 text-[22px] font-semibold leading-tight sm:text-[26px]" style={{ color: "var(--ink)", textWrap: "balance" }}>{t(`b.sec.${def.key}`)}</h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t(`b.secdesc.${def.key}`)}</p>
            <p className="mt-2 text-[12px]" style={{ color: "var(--ink-3)" }}>
              <span className="font-medium">{t("b.shell.used_in")}</span> {t(`b.used.${def.key}`)}
            </p>
          </div>

          {children}

          <div className="mt-8 flex items-center justify-between gap-3 border-t pt-5" style={{ borderColor: "var(--line)" }}>
            <Button variant="secondary" disabled={idx === 0} onClick={() => go(SECTIONS[Math.max(0, idx - 1)].key)}><ArrowLeft size={15} /> {t("Back")}</Button>
            {idx < SECTIONS.length - 1 ? (
              <Button variant="primary" onClick={() => go(SECTIONS[idx + 1].key)}>{t("Next")} <ArrowRight size={15} /></Button>
            ) : published ? null : (
              <Button variant="primary" onClick={() => setPublishOpen(true)}><Rocket size={15} /> {t("b.shell.publish")}</Button>
            )}
          </div>
        </main>

        <aside className="hidden xl:block">
          <div className="sticky top-[84px] space-y-4">
            {published ? <NextSteps ev={ev} t={t} onShare={() => go("share")} /> : null}
            <div className="rounded-[16px] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{t(published ? "b.check.title_live" : "b.check.title")}</p>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink-3)" }}>{`${errors} ${t("b.check.errors")} · ${warnings} ${t("b.check.warnings")}`}</p>
              <div className="-mx-2 mt-3 max-h-[50vh] overflow-y-auto">
                <ChecklistList items={data.checklist} t={t} onGo={go} />
              </div>
              {!published ? (
                <Button variant="primary" className="mt-3 w-full" disabled={errors > 0} onClick={() => setPublishOpen(true)}><Rocket size={15} /> {t("b.shell.publish")}</Button>
              ) : null}
            </div>
            <div className="rounded-[16px] border p-4 text-[12.5px]" style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink-2)" }}>
              <p className="font-semibold" style={{ color: "var(--ink)" }}>{data.plan ? t(`b.plan.${data.plan}`) : t("b.plan.unlimited")}</p>
              <p className="mt-1">{data.limits.participants != null ? `${t("b.plan.participants")}: ${data.limits.participants}` : t("b.plan.no_limit")}</p>
              <p className="mt-1">{`${t("b.plan.registered")}: ${data.capacity.taken}`}</p>
            </div>
          </div>
        </aside>
      </div>

      <Drawer open={checkOpen} onClose={() => setCheckOpen(false)} title={t(published ? "b.check.title_live" : "b.check.title")}>
        <div className="space-y-4">
          {published ? <NextSteps ev={ev} t={t} onShare={() => go("share")} /> : null}
          <ChecklistList items={data.checklist} t={t} onGo={go} />
        </div>
      </Drawer>

      <Modal open={publishOpen} onClose={() => setPublishOpen(false)} title={published ? t("b.pub.live_title") : t("b.pub.title")}>
        <div className="space-y-4">
          {published ? (
            <>
              <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("b.pub.live_body")}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => { setPublishOpen(false); go("share"); }}>{t("b.pub.share")}</Button>
                <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { await onUnpublish(); setPublishOpen(false); } finally { setBusy(false); } }}>{t("b.pub.unpublish")}</Button>
              </div>
              <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>{t("b.pub.unpublish_note")}</p>
            </>
          ) : (
            <>
              <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{errors ? t("b.pub.blocked") : t("b.pub.body")}</p>
              <div className="-mx-2 max-h-[45vh] overflow-y-auto"><ChecklistList items={data.checklist} t={t} onGo={go} /></div>
              {data.plan && !ev.entitlement_id ? <p className="text-[12.5px]" style={{ color: "var(--ink-2)" }}>{t("b.pub.credit_note")}</p> : null}
              {publishError ? (
                <div role="alert" className="rounded-[12px] px-3.5 py-3 text-[13px]" style={{ background: "var(--danger-weak)", color: "var(--ink)" }}>
                  {publishError.message}
                  {publishError.status === 402 ? <> {" "}<Link href="/account" className="font-semibold underline">{t("b.pub.buy")}</Link></> : null}
                </div>
              ) : null}
              <Button variant="primary" className="w-full" disabled={errors > 0} loading={busy} onClick={() => void doPublish()}><Rocket size={15} /> {t("b.pub.go")}</Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
