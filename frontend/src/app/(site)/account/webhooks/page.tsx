"use client";

/**
 * An organisation's outgoing webhooks.
 *
 * The owner or an administrator adds the addresses that should hear about
 * what happens in the organisation's events, sees how each one is doing,
 * sends a test, reads the delivery log and sends a delivery again. Everything
 * is checked by the API (who may, the plan, where an address may point); this
 * page says what it answered in the reader's language.
 *
 * Two details worth keeping if this is ever rewritten:
 *
 *   - The signing secret exists on this page only between the answer that
 *     carries it (creating an endpoint, rotating its secret) and "I have
 *     stored it". It is never fetched again, because the API never gives it
 *     again.
 *   - A reload keeps what is on screen (as on the team page): blanking the
 *     list unmounted the secret panel half a second after it appeared.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Eyebrow, SectionTitle, TableSkeleton } from "@/components/ds/primitives";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import {
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhooksView,
  HEALTH_TONE,
  STATUS_TONE,
  WEBHOOK_EVENT_TYPES,
  createEndpoint,
  deleteEndpoint,
  errorField,
  errorKey,
  healthOf,
  loadDeliveries,
  loadWebhooks,
  prettyPayload,
  receivesAll,
  redeliver,
  rotateSecret,
  sendTest,
  updateEndpoint,
} from "@/lib/webhooks";

type T = (key: string) => string;

const sleep = (ms: number) => new Promise<void>((done) => { window.setTimeout(done, ms); });

/** Why something did not work, in the reader's language. */
function messageOf(err: unknown, t: T): string {
  const key = errorKey(err);
  if (!key) return t("wh.err.generic");
  const max = err instanceof ApiError ? err.fieldErrors.find((f) => typeof f.max === "number")?.max : undefined;
  return fill(t(key), { max: max ?? "" });
}

/** A moment, to the second, in the reader's language. */
function useWhen() {
  const { lang } = useTranslation();
  return (d?: string | null) =>
    (d ? formatDate(d, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "") || "—";
}

function useDay() {
  const { lang } = useTranslation();
  return (d?: string | null) => (d ? formatDate(d, lang, { day: "numeric", month: "short", year: "numeric" }) : "") || "—";
}

const typeLabel = (type: string, t: T) => {
  const key = `wh.type.${type}`;
  const label = t(key);
  return label === key ? type : label;
};

/** The status of a delivery as the log names it: pending is queued before its first attempt, retrying after. */
const statusKey = (d: Pick<WebhookDelivery, "status" | "attempts">) =>
  d.status === "pending" ? (d.attempts > 0 ? "retrying" : "queued") : d.status;

const inputClass = "min-h-11 w-full rounded-[var(--radius)] border px-3.5 text-[15px]";
const inputStyle = { borderColor: "var(--line-strong)", background: "var(--surface-raised)", color: "var(--ink)" };

export default function WebhooksPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<WebhooksView | null>(null);
  const [state, setState] = useState<"loading" | "anonymous" | "not_admin" | "ready" | "error">("loading");
  // ?customerId= picks one of several organisations (read here, not with useSearchParams, so the page stays static).
  const [customerId, setCustomerId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search).get("customerId");
    return q && /^\d+$/.test(q) ? Number(q) : null;
  });
  const [nonce, setNonce] = useState(0);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ value: string; rotated: boolean; host: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* Refetch without blanking what is on screen (see the note at the top). */
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ email?: string }>("/api/auth/me")
      .then(async (user) => {
        if (cancelled) return;
        if (!user?.email) {
          setState("anonymous");
          return;
        }
        try {
          const data = await loadWebhooks(customerId);
          if (cancelled) return;
          setView(data);
          setState("ready");
        } catch (e) {
          if (cancelled) return;
          // "Not an owner or administrator" is a real answer with its own screen, not a failure to load.
          if (e instanceof ApiError && (e.code === "NOT_ORG_ADMIN" || e.status === 403)) setState("not_admin");
          else setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, nonce]);

  const pickOrganisation = (id: number) => {
    setCustomerId(id);
    setAdding(false);
    setSecret(null);
    setNotice(null);
    const url = new URL(window.location.href);
    url.searchParams.set("customerId", String(id));
    window.history.replaceState(null, "", url.toString());
  };

  if (state === "anonymous") {
    return (
      <Shell>
        <SectionTitle as="h1">{t("wh.sign_in_title")}</SectionTitle>
        <Link
          href="/signin?next=%2Faccount%2Fwebhooks"
          className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-5 text-[15px] font-semibold"
          style={{ background: "var(--accent-solid)", color: "#fff" }}
        >
          {t("wh.sign_in")}
        </Link>
      </Shell>
    );
  }

  if (state === "not_admin") {
    return (
      <Shell>
        <SectionTitle as="h1">{t("wh.not_admin_title")}</SectionTitle>
        <Card className="mt-6">
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("wh.not_admin_body")}</p>
          <Link href="/account" className="mt-4 inline-flex min-h-10 items-center gap-2 text-[14px] font-medium" style={{ color: "var(--accent)" }}>
            <ArrowLeft size={14} /> {t("wh.back_account")}
          </Link>
        </Card>
      </Shell>
    );
  }

  const endpoints = view?.endpoints ?? [];
  const max = view?.maxEndpoints ?? 10;
  const locked = view ? !view.enabled : false;
  const scope = view?.organisation.id ?? customerId;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle as="h1">{t("wh.title")}</SectionTitle>
        <Link href="/account" className="inline-flex min-h-10 items-center gap-2 text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
          <ArrowLeft size={14} /> {t("wh.account_link")}
        </Link>
      </div>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("wh.subtitle")}</p>

      {view && view.organisations.length > 1 ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label htmlFor="wh-org" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>{t("wh.org_label")}</label>
          <select
            id="wh-org"
            value={view.organisation.id}
            onChange={(e) => pickOrganisation(Number(e.target.value))}
            className="min-h-10 max-w-full rounded-[var(--radius)] border px-3 text-[14px]"
            style={inputStyle}
          >
            {view.organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      ) : view ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("wh.org_label")}: {view.organisation.name}</p>
      ) : null}

      {state === "error" && !view ? (
        <LoadError text={t("wh.load_failed")} onRetry={reload} />
      ) : !view ? (
        <Card className="mt-6" padded={false}>
          <TableSkeleton rows={3} cols={3} />
        </Card>
      ) : (
        <>
          {locked ? <LockCard hasEndpoints={endpoints.length > 0} /> : null}

          {secret ? (
            <SecretPanel secret={secret.value} rotated={secret.rotated} host={secret.host} onDone={() => setSecret(null)} />
          ) : null}

          <p aria-live="polite" className="mt-4 min-h-[1px] text-[14px]" style={{ color: "var(--ok)" }}>{notice}</p>

          {!locked ? (
            adding ? (
              <EndpointForm
                customerId={scope}
                onCancel={() => setAdding(false)}
                onSaved={(endpoint, value) => {
                  setAdding(false);
                  if (value) setSecret({ value, rotated: false, host: endpoint.urlHost });
                  reload();
                }}
              />
            ) : (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{fill(t("wh.count"), { n: endpoints.length, max })}</p>
                <Button
                  variant="primary"
                  icon={<Plus size={15} />}
                  disabled={endpoints.length >= max}
                  onClick={() => { setAdding(true); setNotice(null); }}
                >
                  {t("wh.add")}
                </Button>
                {endpoints.length >= max ? (
                  <p className="basis-full text-[13px]" style={{ color: "var(--warn)" }}>{fill(t("wh.limit_reached"), { max })}</p>
                ) : null}
              </div>
            )
          ) : null}

          {endpoints.length === 0 && !adding && !locked ? (
            <Card className="mt-4" padded={false}>
              <EmptyState title={t("wh.empty_title")} body={t("wh.empty_body")} icon={<Webhook size={19} />} />
            </Card>
          ) : (
            <ul className="mt-4 space-y-4">
              {endpoints.map((e) => (
                <li key={e.id}>
                  <EndpointCard
                    endpoint={e}
                    customerId={scope}
                    locked={locked}
                    onChanged={reload}
                    onNotice={setNotice}
                    onSecret={(value) => setSecret({ value, rotated: true, host: e.urlHost })}
                  />
                </li>
              ))}
            </ul>
          )}

          <Guide />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="border-b" style={{ borderColor: "var(--line)" }}>
      <div className="mx-auto max-w-4xl px-4 pb-24 pt-14 sm:px-5 sm:pt-20">
        <Eyebrow>{t("acct.eyebrow")}</Eyebrow>
        {children}
      </div>
    </section>
  );
}

function LoadError({ text, onRetry }: { text: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="mt-6 rounded-[var(--radius)] border px-6 py-10 text-center" style={{ borderColor: "var(--warn-weak)", background: "var(--warn-weak)" }}>
      <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{text}</p>
      <Button className="mt-4" size="sm" icon={<RefreshCw size={14} />} onClick={onRetry}>{t("wh.log.refresh")}</Button>
    </div>
  );
}

function LockCard({ hasEndpoints }: { hasEndpoints: boolean }) {
  const { t } = useTranslation();
  return (
    <Card className="mt-6">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
          <Lock size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("wh.lock_title")}</h2>
          <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("wh.lock_body")}</p>
          {hasEndpoints ? <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("wh.lock_existing")}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/pricing" className="inline-flex min-h-10 items-center rounded-[var(--radius-sm)] px-4 text-[14px] font-semibold" style={{ background: "var(--accent-solid)", color: "#fff" }}>
              {t("wh.lock_plans")}
            </Link>
            <Link href="/contact" className="inline-flex min-h-10 items-center rounded-[var(--radius-sm)] border px-4 text-[14px] font-medium" style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}>
              {t("wh.lock_contact")}
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SecretPanel({ secret, rotated, host, onDone }: { secret: string; rotated: boolean; host: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the clipboard can be blocked; the secret is on screen to select by hand */
    }
  };
  return (
    <div role="region" aria-label={t("wh.secret.label")} className="mt-6 rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--warn)", background: "var(--warn-weak)" }}>
      <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
        <KeyRound size={16} style={{ color: "var(--warn)" }} />
        {t(rotated ? "wh.secret.rotated_title" : "wh.secret.title")}
        <span className="text-[13px] font-normal" style={{ color: "var(--ink-3)" }}>· {host}</span>
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {t(rotated ? "wh.secret.rotated_body" : "wh.secret.body")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code
          data-testid="webhook-secret"
          className="min-w-0 flex-1 break-all rounded-[8px] px-3 py-2 text-[12.5px]"
          style={{ background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--font-mono-ui)" }}
        >
          {secret}
        </code>
        <Button size="sm" variant="secondary" onClick={copy} icon={copied ? <Check size={14} /> : <Copy size={14} />}>
          {copied ? t("wh.secret.copied") : t("wh.secret.copy")}
        </Button>
      </div>
      <Button className="mt-3" size="sm" variant="primary" onClick={onDone} icon={<Check size={14} />}>{t("wh.secret.done")}</Button>
    </div>
  );
}

function EndpointForm({
  customerId,
  endpoint,
  onSaved,
  onCancel,
}: {
  customerId: number | null;
  endpoint?: WebhookEndpoint;
  onSaved: (endpoint: WebhookEndpoint, secret: string | null) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const editing = Boolean(endpoint);
  const idBase = editing ? `wh-${endpoint?.id}` : "wh-new";
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [all, setAll] = useState(endpoint ? receivesAll(endpoint.events) : false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(endpoint && !receivesAll(endpoint.events) ? endpoint.events : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string | null; text: string } | null>(null);

  const toggle = (type: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    return next;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!all && picked.size === 0) {
      setError({ field: "events", text: t("wh.form.pick_one") });
      return;
    }
    const events = all ? ["*"] : WEBHOOK_EVENT_TYPES.filter((x) => picked.has(x));
    setBusy(true);
    try {
      if (endpoint) {
        const patch: { url?: string; events?: string[]; description?: string } = { events, description: description.trim() };
        if (url.trim() !== endpoint.url) patch.url = url.trim();
        const out = await updateEndpoint(customerId, endpoint.id, patch);
        onSaved(out.endpoint, null);
      } else {
        const out = await createEndpoint(customerId, { url: url.trim(), events, description: description.trim() });
        onSaved(out.endpoint, out.secret);
      }
    } catch (err) {
      setError({ field: errorField(err), text: messageOf(err, t) });
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (field: string) => (error && error.field === field ? error.text : null);
  const urlError = fieldError("url");
  const eventsError = fieldError("events");
  const descriptionError = fieldError("description");
  const otherError = error && !["url", "events", "description"].includes(error.field ?? "") ? error.text : null;

  return (
    <Card className="mt-4">
      <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t(editing ? "wh.form.edit_title" : "wh.form.new_title")}</h2>
      <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
        <div>
          <label htmlFor={`${idBase}-url`} className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("wh.form.url")}</label>
          <input
            id={`${idBase}-url`}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.example.com/hackos"
            aria-invalid={urlError ? true : undefined}
            aria-describedby={`${idBase}-url-hint${urlError ? ` ${idBase}-url-error` : ""}`}
            className={`${inputClass} mt-1.5`}
            style={inputStyle}
          />
          <p id={`${idBase}-url-hint`} className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("wh.form.url_hint")}</p>
          {urlError ? <p id={`${idBase}-url-error`} className="mt-1 text-[13px]" style={{ color: "var(--danger)" }}>{urlError}</p> : null}
        </div>

        <div>
          <label htmlFor={`${idBase}-description`} className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("wh.form.description")}</label>
          <input
            id={`${idBase}-description`}
            type="text"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("wh.form.description_placeholder")}
            aria-invalid={descriptionError ? true : undefined}
            className={`${inputClass} mt-1.5`}
            style={inputStyle}
          />
          {descriptionError ? <p className="mt-1 text-[13px]" style={{ color: "var(--danger)" }}>{descriptionError}</p> : null}
        </div>

        <fieldset>
          <legend className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("wh.form.events")}</legend>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            <label className="inline-flex min-h-10 items-center gap-2 text-[14px]" style={{ color: "var(--ink)" }}>
              <input type="radio" name={`${idBase}-scope`} checked={!all} onChange={() => setAll(false)} />
              {t("wh.form.some")}
            </label>
            <label className="inline-flex min-h-10 items-center gap-2 text-[14px]" style={{ color: "var(--ink)" }}>
              <input type="radio" name={`${idBase}-scope`} checked={all} onChange={() => setAll(true)} />
              {t("wh.form.all")}
            </label>
          </div>
          {!all ? (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENT_TYPES.map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5"
                  style={{ borderColor: picked.has(type) ? "var(--accent)" : "var(--line)", background: picked.has(type) ? "var(--accent-weak)" : "transparent" }}
                >
                  <input type="checkbox" className="mt-1" checked={picked.has(type)} onChange={() => toggle(type)} />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium" style={{ color: "var(--ink)" }}>{t(`wh.type.${type}`)}</span>
                    <span className="block text-[12.5px] leading-snug" style={{ color: "var(--ink-3)" }}>{t(`wh.type_hint.${type}`)}</span>
                    <code className="mt-0.5 block text-[11.5px]" style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono-ui)" }}>{type}</code>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {eventsError ? <p className="mt-2 text-[13px]" style={{ color: "var(--danger)" }}>{eventsError}</p> : null}
        </fieldset>

        {otherError ? <p className="text-[13px]" style={{ color: "var(--danger)" }}>{otherError}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={busy} disabled={busy}>
            {busy ? t("wh.form.saving") : t(editing ? "wh.form.save" : "wh.form.create")}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>{t("wh.form.cancel")}</Button>
        </div>
      </form>
    </Card>
  );
}

type TestState =
  | { kind: "waiting" }
  | { kind: "delivered"; code: number | null; ms: number | null }
  | { kind: "failed"; reason: string }
  | { kind: "still_waiting" };

function EndpointCard({
  endpoint,
  customerId,
  locked,
  onChanged,
  onNotice,
  onSecret,
}: {
  endpoint: WebhookEndpoint;
  customerId: number | null;
  locked: boolean;
  onChanged: () => void;
  onNotice: (text: string | null) => void;
  onSecret: (secret: string) => void;
}) {
  const { t } = useTranslation();
  const when = useWhen();
  const day = useDay();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "test" | "toggle" | "rotate" | "delete">(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [test, setTest] = useState<TestState | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logKey, setLogKey] = useState(0);
  const [confirm, setConfirm] = useState<null | "rotate" | "delete">(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const health = healthOf(endpoint);
  const host = endpoint.urlHost;

  const runTest = async () => {
    setBusy("test");
    setFailed(null);
    onNotice(null);
    setTest({ kind: "waiting" });
    try {
      const { delivery } = await sendTest(customerId, endpoint.id);
      let final: WebhookDelivery | null = null;
      const until = Date.now() + 20_000;
      while (alive.current && Date.now() < until) {
        await sleep(1200);
        const page = await loadDeliveries(customerId, endpoint.id, { limit: 5 });
        const found = page.items.find((x) => x.id === delivery.id);
        if (found && found.status !== "pending") {
          final = found;
          break;
        }
      }
      if (!alive.current) return;
      if (!final) setTest({ kind: "still_waiting" });
      else if (final.status === "delivered") setTest({ kind: "delivered", code: final.lastStatusCode, ms: final.lastDurationMs });
      else setTest({ kind: "failed", reason: final.lastStatusCode ? `HTTP ${final.lastStatusCode}` : final.lastError || t("wh.log.no_response") });
      setLogKey((k) => k + 1);
      onChanged();
    } catch (err) {
      if (!alive.current) return;
      setTest(null);
      setFailed(messageOf(err, t));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const toggleActive = async () => {
    setBusy("toggle");
    setFailed(null);
    try {
      await updateEndpoint(customerId, endpoint.id, { active: !endpoint.active });
      onNotice(t(endpoint.active ? "wh.switched_off" : "wh.switched_on"));
      onChanged();
    } catch (err) {
      setFailed(messageOf(err, t));
    } finally {
      setBusy(null);
    }
  };

  const doRotate = async () => {
    setConfirm(null);
    setBusy("rotate");
    setFailed(null);
    try {
      const out = await rotateSecret(customerId, endpoint.id);
      onSecret(out.secret);
      onChanged();
    } catch (err) {
      setFailed(messageOf(err, t));
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    setConfirm(null);
    setBusy("delete");
    setFailed(null);
    try {
      await deleteEndpoint(customerId, endpoint.id);
      onNotice(t("wh.deleted"));
      onChanged();
    } catch (err) {
      setFailed(messageOf(err, t));
      setBusy(null);
    }
  };

  if (editing) {
    return (
      <EndpointForm
        customerId={customerId}
        endpoint={endpoint}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onNotice(t("wh.saved"));
          onChanged();
        }}
      />
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{host}</p>
            <Badge tone={HEALTH_TONE[health]} dot>{t(`wh.health.${health}`)}</Badge>
          </div>
          <p className="mt-1 break-all text-[12.5px]" style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono-ui)" }}>{endpoint.url}</p>
          {endpoint.description ? <p className="mt-1.5 text-[14px]" style={{ color: "var(--ink-2)" }}>{endpoint.description}</p> : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {receivesAll(endpoint.events)
          ? <Badge tone="brand">{t("wh.events_all")}</Badge>
          : endpoint.events.map((type) => <Badge key={type} tone="neutral">{typeLabel(type, t)}</Badge>)}
      </div>

      <p className="mt-3 text-[13px]" style={{ color: "var(--ink-3)" }}>
        {endpoint.lastDeliveryAt ? fill(t("wh.last_delivery"), { when: when(endpoint.lastDeliveryAt) }) : t("wh.never_delivered")}
        {" · "}
        {fill(t("wh.added"), { date: day(endpoint.createdAt) })}
        {endpoint.secretRotatedAt ? ` · ${fill(t("wh.rotated"), { date: day(endpoint.secretRotatedAt) })}` : ""}
      </p>
      {health === "failing" && endpoint.consecutiveFailures > 0 ? (
        <p className="mt-2 text-[13px]" style={{ color: "var(--warn)" }}>{fill(t("wh.failures"), { n: endpoint.consecutiveFailures })}</p>
      ) : null}
      {health === "off_failing" ? (
        <p className="mt-2 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] leading-relaxed" style={{ background: "var(--danger-weak)", color: "var(--ink)" }}>
          {fill(t("wh.off_failing_body"), { n: endpoint.consecutiveFailures })}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        {!locked ? (
          <Button size="sm" variant="secondary" icon={<Send size={14} />} loading={busy === "test"} disabled={busy != null} onClick={runTest}>
            {busy === "test" ? t("wh.action.testing") : t("wh.action.test")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          icon={logOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          aria-expanded={logOpen}
          onClick={() => setLogOpen((o) => !o)}
        >
          {logOpen ? t("wh.action.hide_log") : t("wh.action.log")}
        </Button>
        {!locked ? (
          <>
            <Button size="sm" variant="ghost" icon={<Pencil size={14} />} disabled={busy != null} onClick={() => setEditing(true)}>{t("wh.action.edit")}</Button>
            <Button size="sm" variant="ghost" icon={endpoint.active ? <PowerOff size={14} /> : <Power size={14} />} loading={busy === "toggle"} disabled={busy != null} onClick={toggleActive}>
              {endpoint.active ? t("wh.action.disable") : t("wh.action.enable")}
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} disabled={busy != null} onClick={() => setConfirm("rotate")}>{t("wh.action.rotate")}</Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={14} />}
          disabled={busy != null}
          onClick={() => setConfirm("delete")}
          style={{ color: "var(--danger)" }}
          aria-label={`${t("wh.action.delete")} · ${host}`}
        >
          {t("wh.action.delete")}
        </Button>
      </div>

      <div aria-live="polite">
        {test ? (
          <p
            className="mt-3 text-[13px]"
            style={{ color: test.kind === "delivered" ? "var(--ok)" : test.kind === "failed" ? "var(--danger)" : "var(--ink-2)" }}
          >
            {test.kind === "waiting"
              ? t("wh.test.waiting")
              : test.kind === "delivered"
                ? fill(t("wh.test.delivered"), { code: test.code ?? "—", ms: test.ms ?? "—" })
                : test.kind === "failed"
                  ? fill(t("wh.test.failed"), { reason: test.reason })
                  : t("wh.test.still_waiting")}
          </p>
        ) : null}
        {failed ? <p className="mt-3 text-[13px]" style={{ color: "var(--danger)" }}>{failed}</p> : null}
      </div>

      {logOpen ? <DeliveryLog customerId={customerId} endpointId={endpoint.id} refreshKey={logKey} locked={locked} /> : null}

      <ConfirmDialog
        open={confirm === "rotate"}
        title={t("wh.rotate.title")}
        message={t("wh.rotate.body")}
        confirmLabel={t("wh.rotate.confirm")}
        cancelLabel={t("wh.form.cancel")}
        onConfirm={doRotate}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title={t("wh.delete.title")}
        message={fill(t("wh.delete.body"), { host })}
        confirmLabel={t("wh.delete.confirm")}
        cancelLabel={t("wh.form.cancel")}
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}

function DeliveryLog({ customerId, endpointId, refreshKey, locked }: { customerId: number | null; endpointId: number; refreshKey: number; locked: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<WebhookDelivery[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDeliveries(customerId, endpointId, { limit: 20 })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNext(page.nextBefore);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, endpointId, refreshKey, nonce]);

  // While a delivery is about to be tried, look again every few seconds; retries hours away are not waited for.
  const soon = (items ?? []).some((d) => d.status === "pending" && (!d.nextAttemptAt || Date.parse(d.nextAttemptAt) - Date.now() < 60_000));
  useEffect(() => {
    if (!soon) return undefined;
    const timer = window.setInterval(() => setNonce((n) => n + 1), 4000);
    return () => window.clearInterval(timer);
  }, [soon]);

  const loadMore = async () => {
    if (next == null) return;
    setMore(true);
    try {
      const page = await loadDeliveries(customerId, endpointId, { limit: 20, before: next });
      setItems((list) => [...(list ?? []), ...page.items]);
      setNext(page.nextBefore);
    } catch {
      setFailed(true);
    } finally {
      setMore(false);
    }
  };

  return (
    <div className="mt-4 rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{t("wh.log.title")}</h3>
          <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("wh.log.hint")}</p>
        </div>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => { setNotice(null); setNonce((n) => n + 1); }}>{t("wh.log.refresh")}</Button>
      </div>
      <p aria-live="polite" className="px-4 text-[13px]" style={{ color: "var(--ok)" }}>{notice}</p>
      {failed && !items ? (
        <p className="px-4 py-6 text-[13px]" style={{ color: "var(--danger)" }}>{t("wh.log.load_failed")}</p>
      ) : !items ? (
        <p className="px-4 py-6 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("wh.log.loading")}</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("wh.log.empty")}</p>
      ) : (
        <ul>
          {items.map((d) => (
            <DeliveryRow
              key={d.id}
              delivery={d}
              customerId={customerId}
              locked={locked}
              onRedelivered={() => {
                setNotice(t("wh.log.redelivered"));
                setNonce((n) => n + 1);
              }}
            />
          ))}
        </ul>
      )}
      {items && next != null ? (
        <div className="border-t px-4 py-3" style={{ borderColor: "var(--line)" }}>
          <Button size="sm" variant="secondary" loading={more} disabled={more} onClick={loadMore}>{more ? t("wh.log.loading") : t("wh.log.more")}</Button>
        </div>
      ) : null}
    </div>
  );
}

function DeliveryRow({ delivery: d, customerId, locked, onRedelivered }: { delivery: WebhookDelivery; customerId: number | null; locked: boolean; onRedelivered: () => void }) {
  const { t } = useTranslation();
  const when = useWhen();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const status = statusKey(d);
  const tone = d.status === "pending" ? "warn" : STATUS_TONE[d.status];

  const again = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await redeliver(customerId, d.endpointId, d.id);
      onRedelivered();
    } catch (err) {
      setFailed(messageOf(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: "var(--line)" }} data-delivery-type={d.type} data-delivery-status={d.status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge tone={tone}>{t(`wh.status.${status}`)}</Badge>
        <span className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>{typeLabel(d.type, t)}</span>
        <span className="text-[12.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>{when(d.createdAt)}</span>
        <span className="text-[12.5px] tabular-nums" style={{ color: d.lastStatusCode && d.lastStatusCode < 300 ? "var(--ok)" : "var(--ink-2)", fontFamily: "var(--font-mono-ui)" }}>
          {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : d.attempts > 0 ? t("wh.log.no_response") : ""}
        </span>
        {d.lastDurationMs != null ? (
          <span className="text-[12.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>{fill(t("wh.log.duration"), { ms: d.lastDurationMs })}</span>
        ) : null}
        {d.maxAttempts > 1 && d.attempts > 0 ? (
          <span className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{fill(t("wh.log.attempts"), { n: d.attempts, max: d.maxAttempts })}</span>
        ) : null}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? t("wh.log.hide_details") : t("wh.log.details")}</Button>
          {!locked && d.status !== "pending" ? (
            <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} loading={busy} disabled={busy} onClick={again}>
              {busy ? t("wh.log.redelivering") : t("wh.log.redeliver")}
            </Button>
          ) : null}
        </span>
      </div>
      {d.status === "pending" && d.attempts > 0 && d.nextAttemptAt ? (
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--warn)" }}>{fill(t("wh.log.next"), { when: when(d.nextAttemptAt) })}</p>
      ) : null}
      {d.redeliveryOf ? <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{fill(t("wh.log.redelivery_of"), { id: d.redeliveryOf })}</p> : null}
      {d.lastError && !open ? (
        <p className="mt-1 break-words text-[12.5px]" style={{ color: "var(--danger)", fontFamily: "var(--font-mono-ui)" }}>{d.lastError}</p>
      ) : null}
      {failed ? <p className="mt-1 text-[13px]" style={{ color: "var(--danger)" }}>{failed}</p> : null}
      {open ? (
        <dl className="mt-3 space-y-3 text-[12.5px]">
          <div>
            <dt className="font-medium" style={{ color: "var(--ink-2)" }}>{t("wh.log.delivery_id")}</dt>
            <dd className="break-all" style={{ color: "var(--ink)", fontFamily: "var(--font-mono-ui)" }}>{d.deliveryId}</dd>
          </div>
          {d.lastError ? (
            <div>
              <dt className="font-medium" style={{ color: "var(--ink-2)" }}>{t("wh.log.error")}</dt>
              <dd className="break-words" style={{ color: "var(--danger)", fontFamily: "var(--font-mono-ui)" }}>{d.lastError}</dd>
            </div>
          ) : null}
          {d.lastResponse ? (
            <div>
              <dt className="font-medium" style={{ color: "var(--ink-2)" }}>{t("wh.log.response")}</dt>
              <dd>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[8px] p-2.5" style={{ background: "var(--tint)", color: "var(--ink)", fontFamily: "var(--font-mono-ui)" }}>{d.lastResponse}</pre>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-medium" style={{ color: "var(--ink-2)" }}>{t("wh.log.payload")}</dt>
            <dd>
              <pre className="mt-1 max-h-72 overflow-auto rounded-[8px] p-2.5 text-[12px]" style={{ background: "var(--tint)", color: "var(--ink)", fontFamily: "var(--font-mono-ui)" }}>{prettyPayload(d.payload)}</pre>
            </dd>
          </div>
        </dl>
      ) : null}
    </li>
  );
}

const NODE_EXAMPLE = `const crypto = require('crypto');

app.post('/hackos', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-HackOS-Timestamp') || '';
  const sig = req.get('X-HackOS-Signature') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.HACKOS_WEBHOOK_SECRET)
    .update(ts + '.').update(req.body).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) <= 300;
  const genuine = sig.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!fresh || !genuine) return res.sendStatus(401);
  res.sendStatus(204); // answer first, then do the work
  handle(JSON.parse(req.body)); // ignore an id you have already seen
});`;

function Guide() {
  const { t } = useTranslation();
  return (
    <details className="mt-10 rounded-[var(--radius)] border px-5 py-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
      <summary className="cursor-pointer text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("wh.guide.title")}</summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        <li>{t("wh.guide.step1")}</li>
        <li>{t("wh.guide.step2")}</li>
        <li>{t("wh.guide.step3")}</li>
        <li>{t("wh.guide.step4")}</li>
      </ol>
      <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("wh.guide.dedupe")}</p>
      <p className="mt-3 text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>{t("wh.guide.example")}</p>
      <pre className="mt-2 overflow-x-auto rounded-[8px] p-3 text-[12px] leading-relaxed" style={{ background: "var(--tint)", color: "var(--ink)", fontFamily: "var(--font-mono-ui)" }}>
        <code>{NODE_EXAMPLE}</code>
      </pre>
    </details>
  );
}
