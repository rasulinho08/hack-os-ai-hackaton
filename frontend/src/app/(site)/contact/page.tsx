"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CalendarDays, Check, GraduationCap, Mail, MapPin, Play, Users } from "lucide-react";
import { Badge, Card, Eyebrow, Lead, SectionTitle } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { CONTACT_EMAIL } from "@/lib/site";
import { CONTACT_COPY, ROLE_VALUES, SIZE_VALUES, type Lang } from "./copy";

/**
 * The form posts to POST /api/leads, which e-mails the sales inbox with
 * Reply-To set to the visitor. It used to compose a mailto: link, which sent
 * nothing for anyone without a desktop mail client set up. If the API cannot
 * send, the visitor is told and offered the address to write to directly.
 */
const noSubscribe = () => () => {};

export default function ContactPage() {
  const { lang: rawLang } = useTranslation();
  const lang: Lang = rawLang === "az" || rawLang === "ru" ? rawLang : "en";
  const copy = CONTACT_COPY[lang];
  const f = copy.form;
  const [form, setForm] = useState({
    name: "",
    org: "",
    email: "",
    role: "Organiser",
    participants: "100–300",
    when: "",
    message: "",
    website: "",
  });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // ?topic=enterprise (the pricing page's Enterprise links) or ?topic=community (its
  // "Apply" for the free Community plan): the enquiry is about that plan.
  // Read from the address after hydration; the server render has no query.
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  const query = new URLSearchParams(search);
  const topic = {
    enterprise: query.get("topic") === "enterprise",
    community: query.get("topic") === "community",
    plan: (query.get("plan") ?? "").slice(0, 40),
  };
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const ready = form.name.trim() !== "" && form.org.trim() !== "" && emailOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || state === "sending") return;
    setState("sending");
    setError("");
    try {
      await apiPost("/api/leads", {
        name: form.name.trim(),
        email: form.email.trim(),
        organisation: form.org.trim(),
        topic: topic.enterprise ? `Enterprise · ${form.role}` : topic.community ? `Community plan application · ${form.role}` : form.role,
        message: [
          ...(topic.enterprise ? [`About: Enterprise plan${topic.plan && topic.plan !== "enterprise" ? ` (from the ${topic.plan} card)` : ""}`] : []),
          ...(topic.community ? ["About: applying for the free Community plan (student club or non-commercial university event)"] : []),
          `Expected participants: ${form.participants}`,
          `Approximate dates: ${form.when || "—"}`,
          "",
          form.message,
        ].join("\n"),
        website: form.website,
      });
      setState("sent");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : f.failed);
      setState("error");
    }
  };

  const field =
    "min-h-11 w-full rounded-[var(--hs-radius-sm)] border px-3 text-[15px] outline-none focus:border-[var(--hs-ink-3)]";
  const fieldStyle = {
    borderColor: "var(--hs-line-2)",
    background: "var(--hs-surface)",
    color: "var(--hs-ink)",
  };

  return (
    <>
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pt-20">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
            <div>
              <Eyebrow>{copy.eyebrow}</Eyebrow>
              <SectionTitle as="h1">{copy.title}</SectionTitle>
              <Lead>{copy.lead}</Lead>

              <dl className="mt-10 space-y-5">
                {[
                  { icon: Mail, label: copy.info.email, value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
                  { icon: MapPin, label: copy.info.based, value: copy.info.basedValue },
                  { icon: CalendarDays, label: copy.info.response, value: copy.info.responseValue },
                  { icon: Users, label: copy.info.languages, value: "Azərbaycan · English · Русский" },
                ].map((r) => {
                  const Icon = r.icon;
                  return (
                    // dt and dd stay direct children of the group (the list's rule); the icon sits in the dt.
                    <div key={r.label} className="relative min-w-0 pl-11">
                      <dt className="text-[11px] uppercase tracking-[0.09em]" style={{ color: "var(--hs-ink-3)" }}>
                        <span
                          className="absolute left-0 top-0.5 inline-flex h-8 w-8 items-center justify-center rounded-[7px]"
                          style={{ background: "var(--hs-tint)", color: "var(--hs-ink-2)" }}
                          aria-hidden="true"
                        >
                          <Icon size={15} />
                        </span>
                        {r.label}
                      </dt>
                      <dd className="text-[15px]" style={{ color: "var(--hs-ink)" }}>
                        {r.href ? (
                          <a href={r.href} className="hover:underline" style={{ color: "var(--hs-brand)" }}>
                            {r.value}
                          </a>
                        ) : (
                          r.value
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  href="/demo"
                  className="inline-flex min-h-11 items-center gap-2 rounded-[var(--hs-radius-sm)] border px-5 text-[15px] font-medium"
                  style={{ borderColor: "var(--hs-ink)", color: "var(--hs-ink)" }}
                >
                  <Play size={15} /> {copy.lookAround}
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium"
                  style={{ color: "var(--hs-brand)" }}
                >
                  {copy.seePlans} <ArrowRight size={15} />
                </Link>
              </div>
            </div>

            {/* ── Form ─────────────────────────────────────────────── */}
            <Card className="lg:sticky lg:top-24 lg:self-start">
              <div className="mb-5 flex items-center justify-between gap-3">
                <p
                  className="text-[15px] font-semibold"
                  style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}
                >
                  {f.title}
                </p>
                <Badge>{f.minutes}</Badge>
              </div>

              {state === "sent" ? (
                <div role="status" className="py-6">
                  <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>
                    <Check size={16} style={{ color: "var(--hs-brand)" }} /> {f.sentTitle}
                  </p>
                  <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                    {fill(f.sentBody, { email: form.email.trim() })}
                  </p>
                </div>
              ) : (
              <form onSubmit={submit} noValidate>
              {topic.enterprise ? (
                <p className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-medium" style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}>
                  <Building2 size={14} /> {f.topicEnterprise}
                </p>
              ) : topic.community ? (
                <p className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-medium" style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}>
                  <GraduationCap size={14} /> {f.topicCommunity}
                </p>
              ) : null}
              <div className="space-y-3.5">
                {/* Honeypot: invisible to people, filled in by bots. */}
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="absolute -left-[9999px] h-0 w-0 opacity-0"
                  value={form.website}
                  onChange={set("website")}
                />
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium" style={{ color: "var(--hs-ink-2)" }}>
                    {f.name}
                  </span>
                  <input className={field} style={fieldStyle} value={form.name} onChange={set("name")} required autoComplete="name" />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium" style={{ color: "var(--hs-ink-2)" }}>
                    {f.org}
                  </span>
                  <input className={field} style={fieldStyle} value={form.org} onChange={set("org")} required autoComplete="organization" />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium" style={{ color: "var(--hs-ink-2)" }}>
                    {f.email}
                  </span>
                  <input
                    type="email"
                    className={field}
                    style={fieldStyle}
                    value={form.email}
                    onChange={set("email")}
                    required
                    autoComplete="email"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-medium" style={{ color: "var(--hs-ink-2)" }}>
                      {f.youAre}
                    </span>
                    <select className={field} style={fieldStyle} value={form.role} onChange={set("role")}>
                      {ROLE_VALUES.map((o, i) => (
                        <option key={o} value={o}>{f.roles[i] ?? o}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-medium" style={{ color: "var(--hs-ink-2)" }}>
                      {f.participants}
                    </span>
                    <select
                      className={field}
                      style={fieldStyle}
                      value={form.participants}
                      onChange={set("participants")}
                    >
                      {SIZE_VALUES.map((o, i) => (
                        <option key={o} value={o}>{f.sizes[i] ?? o}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium" style={{ color: "var(--hs-ink-2)" }}>
                    {f.dates}
                  </span>
                  <input
                    className={field}
                    style={fieldStyle}
                    placeholder={f.datesPlaceholder}
                    value={form.when}
                    onChange={set("when")}
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium" style={{ color: "var(--hs-ink-2)" }}>
                    {f.more}
                  </span>
                  <textarea
                    rows={4}
                    className="w-full rounded-[var(--hs-radius-sm)] border p-3 text-[15px] outline-none"
                    style={fieldStyle}
                    placeholder={f.morePlaceholder}
                    value={form.message}
                    onChange={set("message")}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={!ready || state === "sending"}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--hs-radius-sm)] px-5 text-[15px] font-semibold disabled:cursor-not-allowed"
                style={{
                  background: ready ? "var(--hs-brand-solid)" : "var(--hs-tint-2)",
                  color: ready ? "#fff" : "var(--hs-ink-2)",
                }}
              >
                {state === "sending" ? f.sending : f.send} <ArrowRight size={15} />
              </button>

              {state === "error" ? (
                <p role="alert" className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--hs-brand)" }}>
                  {error}{" "}
                  {f.writeTo.split(/(\{email\})/).map((part, k) =>
                    part === "{email}" ? (
                      <a key={k} href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>
                    ) : (
                      part
                    ),
                  )}
                </p>
              ) : (
                <p className="mt-3 text-[12px] leading-relaxed" style={{ color: "var(--hs-ink-3)" }}>
                  {f.privacy}
                </p>
              )}
              </form>
              )}
            </Card>
          </div>
        </div>
      </section>

      {/* ── What happens next ────────────────────────────────────────── */}
      <section className="hs-grid" style={{ background: "var(--hs-deep)" }}>
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <SectionTitle light>{copy.next.title}</SectionTitle>
          <ol className="hs-stagger mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
            {copy.next.steps.map((step, i) => ({ n: String(i + 1).padStart(2, "0"), ...step })).map((s) => (
              <li key={s.n}>
                <span
                  className="text-[13px] font-medium"
                  style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-brand-lift)" }}
                >
                  {s.n}
                </span>
                <p
                  className="mt-2 text-lg font-semibold tracking-[-0.01em]"
                  style={{ fontFamily: "var(--font-display)", color: "var(--hs-on-deep)" }}
                >
                  {s.title}
                </p>
                <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: "var(--hs-on-deep-2)" }}>
                  {s.body}
                </p>
              </li>
            ))}
          </ol>

          <div
            className="mt-12 flex flex-wrap items-center gap-4 border-t pt-8"
            style={{ borderColor: "var(--hs-line-deep)" }}
          >
            <Building2 size={16} style={{ color: "var(--hs-on-deep-3)" }} />
            <p className="text-[13px]" style={{ color: "var(--hs-on-deep-3)" }}>
              {copy.next.rates}
            </p>
            <Check size={14} className="ml-auto" style={{ color: "var(--hs-brand-lift)" }} />
          </div>
        </div>
      </section>
    </>
  );
}
