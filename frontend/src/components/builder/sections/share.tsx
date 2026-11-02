"use client";

import { useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { ArrowDown, ArrowUp, Check, Copy, Download, ExternalLink, Globe2, Lightbulb, Link2, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { appOrigin } from "@/lib/hosts";
import { Card, Notice, Segmented, TextArea, TextInput, Toggle } from "../ui";
import type { FaqItem } from "@/lib/builder/types";
import type { SectionCtx } from "./context";

const SUGGESTED = ["who", "cost", "team", "bring", "judging", "online"];

/** The public address of the event page, absolute. */
export function eventPageUrl(slug: string): string {
  const origin = appOrigin() || (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin}/e/${slug}`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-[12.5px] font-medium"
      style={{ borderColor: "var(--line-strong)", color: done ? "var(--ok)" : "var(--ink)" }}
      aria-label={label}
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {label}
    </button>
  );
}

const CHANNELS = ["instagram", "linkedin", "telegram", "whatsapp", "facebook", "email", "qr"];

export function ShareKit({ ctx }: { ctx: SectionCtx }) {
  const { ev, data, t, f } = ctx;
  const canvasWrap = useRef<HTMLDivElement>(null);
  const base = eventPageUrl(ev.slug);
  const counts = useMemo(() => Object.fromEntries(data.refs.map((r) => [r.source, r.registrations])), [data.refs]);
  const qrUrl = `${base}?ref=qr`;

  const downloadQr = () => {
    const canvas = canvasWrap.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${ev.slug}-qr.png`;
    a.click();
  };

  return (
    <Card title={t("b.share.kit")} description={ev.is_published ? t("b.share.kit_help") : t("b.share.kit_draft")}>
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border px-3 py-2.5" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" style={{ color: "var(--ink)" }}>{base}</span>
        <CopyButton text={base} label={t("b.share.copy")} />
        {ev.is_published ? (
          <a href={base} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-[12.5px] font-medium" style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}>
            <ExternalLink size={13} /> {t("b.share.open")}
          </a>
        ) : null}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="mb-2 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("b.share.tracked")}</p>
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {CHANNELS.filter((c) => c !== "qr").map((c) => {
              const url = `${base}?ref=${c}`;
              return (
                <li key={c} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-24 shrink-0 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t(`b.share.ch_${c}`)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]" style={{ color: "var(--ink-3)" }}>?ref={c}</span>
                  <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-2)" }}>{f("b.share.regs", { n: counts[c] || 0 })}</span>
                  <CopyButton text={url} label={t("b.share.copy")} />
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[12px]" style={{ color: "var(--ink-3)" }}>{f("b.share.direct", { n: counts.direct || 0 })}</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div ref={canvasWrap} className="rounded-[12px] bg-white p-3">
            <QRCodeCanvas value={qrUrl} size={176} level="M" marginSize={1} />
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink-2)" }}>{f("b.share.regs", { n: counts.qr || 0 })}</p>
          <Button size="sm" variant="secondary" onClick={downloadQr}><Download size={14} /> {t("b.share.qr_download")}</Button>
        </div>
      </div>
    </Card>
  );
}

type Visibility = "public" | "private" | "invite";

/** Who can find the event, and whether it is listed in the public directory. */
export function VisibilityCard({ ctx }: { ctx: SectionCtx }) {
  const { ev, set, err, t } = ctx;
  const visibility: Visibility = ev.visibility ?? "public";
  const listed = ev.directory_listed ?? true;
  return (
    <Card title={t("b.share.visibility")} description={t("b.share.visibility_help")}>
      <Segmented<Visibility>
        value={visibility}
        onChange={(v) => set({ visibility: v })}
        error={err("visibility")}
        columns={3}
        options={[
          { value: "public", label: t("b.share.vis_public"), hint: t("b.share.vis_public_hint"), icon: <Globe2 size={15} aria-hidden="true" /> },
          { value: "private", label: t("b.share.vis_private"), hint: t("b.share.vis_private_hint"), icon: <Link2 size={15} aria-hidden="true" /> },
          { value: "invite", label: t("b.share.vis_invite"), hint: t("b.share.vis_invite_hint"), icon: <Lock size={15} aria-hidden="true" /> },
        ]}
      />
      <Toggle
        label={t("b.share.directory")}
        help={visibility === "public" ? t("b.share.directory_help") : t("b.share.directory_off")}
        checked={visibility === "public" && listed}
        disabled={visibility !== "public"}
        onChange={(v) => set({ directory_listed: v })}
      />
      {visibility === "invite" ? (
        <Notice tone="info">
          {t("b.share.vis_invite_note")}{" "}
          <a href="/invitations" className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("b.share.vis_invite_link")}</a>
        </Notice>
      ) : null}
      {visibility === "public" && listed && ev.is_published ? (
        <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          <a href="/hackathons" target="_blank" rel="noreferrer" className="underline underline-offset-2">{t("b.share.directory_see")}</a>
        </p>
      ) : null}
    </Card>
  );
}

export function ShareSection(ctx: SectionCtx) {
  const { ev, set, err, t } = ctx;
  /*
   * The FAQ is edited locally and sent without rows that are still empty:
   * the API drops empty rows, and taking its answer back would make a row
   * the organiser just added vanish before they typed into it.
   */
  const [faq, setLocalFaq] = useState<FaqItem[]>(ev.faq || []);
  const setFaq = (next: FaqItem[]) => {
    setLocalFaq(next);
    set({ faq: next.filter((x) => x.q.trim() || x.a.trim()) });
  };
  const [slug, setSlug] = useState(ev.slug);
  return (
    <div className="space-y-5">
      <VisibilityCard ctx={ctx} />
      <Card title={t("b.share.rules")} description={t("b.share.rules_help")}>
        <TextArea label={t("b.share.rules_label")} value={ev.rules} onChange={(v) => set({ rules: v })} rows={12} maxLength={30000} error={err("rules")}
          required={ev.eligibility.requireRules} />
      </Card>
      <Card title={t("b.share.faq")} description={t("b.share.faq_help")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setFaq([...faq, ...SUGGESTED.filter((k) => !faq.some((x) => x.q === t(`b.faq.${k}`))).map((k) => ({ q: t(`b.faq.${k}`), a: "" }))])}>
              <Lightbulb size={14} /> {t("b.share.faq_suggest")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setFaq([...faq, { q: "", a: "" }])}><Plus size={14} /> {t("b.share.faq_add")}</Button>
          </div>
        }>
        {faq.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("b.share.faq_none")}</p> : null}
        {faq.map((item, i) => (
          <div key={i} className="space-y-3 rounded-[12px] border p-3.5" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <TextInput label={t("b.share.question")} value={item.q} maxLength={300} error={err(`faq.${i}.q`)}
                  onChange={(v) => setFaq(faq.map((x, j) => (j === i ? { ...x, q: v } : x)))} />
              </div>
              <div className="flex items-center gap-1 pt-6">
                <button type="button" disabled={i === 0} aria-label={t("b.common.up")} onClick={() => { const n = [...faq]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setFaq(n); }} className="rounded p-1.5 hover:bg-[var(--tint)] disabled:opacity-30"><ArrowUp size={15} /></button>
                <button type="button" disabled={i === faq.length - 1} aria-label={t("b.common.down")} onClick={() => { const n = [...faq]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setFaq(n); }} className="rounded p-1.5 hover:bg-[var(--tint)] disabled:opacity-30"><ArrowDown size={15} /></button>
                <button type="button" aria-label={t("Delete")} onClick={() => setFaq(faq.filter((_, j) => j !== i))} className="rounded p-1.5 hover:bg-[var(--tint)]" style={{ color: "var(--danger)" }}><Trash2 size={15} /></button>
              </div>
            </div>
            <TextArea label={t("b.share.answer")} value={item.a} rows={3} maxLength={4000} error={err(`faq.${i}.a`)}
              onChange={(v) => setFaq(faq.map((x, j) => (j === i ? { ...x, a: v } : x)))} />
          </div>
        ))}
      </Card>
      <Card title={t("b.share.link")} description={t("b.share.link_help")}>
        <div className="flex flex-wrap items-end gap-2">
          <TextInput className="min-w-[14rem] flex-1" label={t("b.share.slug")} value={slug} prefix="/e/" maxLength={80} error={err("slug")}
            onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-"))} />
          <Button variant="secondary" disabled={slug === ev.slug || !slug} onClick={() => set({ slug: slug.replace(/^-+|-+$/g, "") })}>{t("Save")}</Button>
        </div>
        {ev.is_published && slug !== ev.slug ? <Notice tone="warn">{t("b.share.slug_warning")}</Notice> : null}
        <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("b.share.code")} <span className="font-mono font-semibold" style={{ color: "var(--ink)" }}>{ev.event_code}</span></p>
      </Card>
      <ShareKit ctx={ctx} />
    </div>
  );
}
