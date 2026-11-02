"use client";

/**
 * The event's Telegram channel, on the organiser's announcements page:
 * connect it (a one-time code posted in the channel, or a public channel's
 * @name), see where announcements go and whether the last post worked, send
 * a test, switch copying of the organiser's own posts, disconnect.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Send, Unlink, AlertTriangle } from "lucide-react";
import { Badge, Button } from "@/components/ds/primitives";
import { TextInput, Toggle } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { formatRelativeTime } from "@/lib/relativeTime";
import { formatDate } from "@/lib/i18n/dates";

interface ChannelState {
  configured: boolean;
  botUsername: string | null;
  linked: boolean;
  channel: null | {
    title: string | null;
    username: string | null;
    type: string;
    linkedAt: string;
    linkedBy: string | null;
    mirrorPosts: boolean;
    lastPostAt: string | null;
    lastError: string | null;
  };
}

const WATCH_EVERY_MS = 3_000;

export function TelegramChannelCard({ eventId }: { eventId: number }) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<ChannelState | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<{ command: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<ChannelState>(`/api/events/${eventId}/telegram`);
      setState(d);
      setLocked(false);
      return d;
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_DISABLED") setLocked(true);
      setState(null);
      return null;
    }
  }, [eventId]);

  useEffect(() => {
    setCode(null);
    void load();
  }, [load]);

  // A code is out: watch for the channel to connect.
  useEffect(() => {
    if (!code || state?.linked) return undefined;
    const timer = setInterval(async () => {
      if (new Date(code.expiresAt).getTime() < Date.now()) {
        clearInterval(timer);
        return;
      }
      const d = await load();
      if (d?.linked) {
        clearInterval(timer);
        setCode(null);
        toast(t("tg.connected_now"), "success");
      }
    }, WATCH_EVERY_MS);
    return () => clearInterval(timer);
  }, [code, state?.linked, load, t, toast]);

  const errorText = (err: unknown) => {
    const c = err instanceof ApiError ? err.code : undefined;
    const key = c ? `tg.err.${c}` : "";
    const translated = key ? t(key) : "";
    return translated && translated !== key ? translated : t("an.toast.failed");
  };

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (err) {
      toast(errorText(err), "error", 7000);
    } finally {
      setBusy(null);
    }
  };

  const getCode = () => run("code", async () => {
    const d = await apiPost<{ command: string; expiresAt: string }>(`/api/events/${eventId}/telegram/code`, {});
    setCode(d);
    setCopied(false);
  });

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const linkByName = () => run("name", async () => {
    setNameError(null);
    try {
      const d = await apiPost<ChannelState>(`/api/events/${eventId}/telegram/link`, { username: name.trim() });
      setState(d);
      setName("");
      toast(t("tg.connected_now"), "success");
    } catch (err) {
      setNameError(errorText(err));
    }
  });

  const test = () => run("test", async () => {
    const d = await apiPost<ChannelState>(`/api/events/${eventId}/telegram/test`, {});
    setState(d);
    toast(t("tg.test_ok"), "success");
  });

  const setMirror = (on: boolean) => run("mirror", async () => {
    const d = await apiPatch<ChannelState>(`/api/events/${eventId}/telegram`, { mirrorPosts: on });
    setState(d);
  });

  const disconnect = () => run("off", async () => {
    setConfirmOff(false);
    const d = await apiDelete<ChannelState>(`/api/events/${eventId}/telegram`);
    setState(d);
    toast(t("tg.disconnected"), "success");
  });

  const shell = (children: React.ReactNode) => (
    <section className="rounded-[var(--radius)] border p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }} aria-labelledby="tg-card-title">
      <div className="mb-3 flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--info-weak)", color: "var(--info)" }}>
          <Send size={16} />
        </span>
        <div className="min-w-0">
          <h3 id="tg-card-title" className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{t("tg.card_title")}</h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("tg.card_desc")}</p>
        </div>
      </div>
      {children}
    </section>
  );

  if (locked) return shell(<p className="text-[13px]" style={{ color: "var(--ink-2)" }}>{t("an.err.MODULE_DISABLED")}</p>);
  if (!state) return null;
  if (!state.configured) return shell(<p className="text-[13px]" style={{ color: "var(--ink-2)" }}>{t("tg.off")}</p>);

  const bot = state.botUsername ? `@${state.botUsername}` : "";
  const ch = state.channel;

  if (state.linked && ch) {
    return shell(
      <div className="space-y-3">
        <div className="rounded-[var(--radius-sm)] px-3 py-2.5" style={{ background: "var(--tint)" }}>
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>
            <Badge tone="ok" dot>{fill(t("tg.linked_to"), { title: ch.title || (ch.username ? `@${ch.username}` : "Telegram") })}</Badge>
            {ch.username ? (
              <a href={`https://t.me/${ch.username}`} target="_blank" rel="noopener noreferrer" className="text-[12.5px] underline underline-offset-2" style={{ color: "var(--ink-2)" }}>
                t.me/{ch.username}
              </a>
            ) : null}
          </p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
            {fill(t("tg.linked_meta"), { time: formatRelativeTime(ch.linkedAt, lang) })}
            {ch.linkedBy ? ` · ${fill(t("tg.linked_by"), { name: ch.linkedBy })}` : ""}
            {ch.lastPostAt ? ` · ${fill(t("tg.last_post"), { time: formatRelativeTime(ch.lastPostAt, lang) })}` : ""}
          </p>
        </div>
        {ch.lastError ? (
          <p className="flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px]" style={{ background: "var(--danger-weak)", color: "var(--danger)" }} role="alert">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {fill(t("tg.last_error"), { error: ch.lastError })}
          </p>
        ) : null}
        <Toggle label={t("tg.mirror")} help={t("tg.mirror_hint")} checked={ch.mirrorPosts} onChange={setMirror} disabled={busy === "mirror"} compact />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Send size={14} />} onClick={test} loading={busy === "test"}>{t("tg.test")}</Button>
          <Button size="sm" variant="ghost" icon={<Unlink size={14} />} onClick={() => setConfirmOff(true)} disabled={busy === "off"}>{t("tg.disconnect")}</Button>
        </div>
        <ConfirmDialog
          open={confirmOff}
          title={t("tg.disconnect")}
          message={fill(t("tg.linked_to"), { title: ch.title || ch.username || "Telegram" })}
          confirmLabel={t("tg.disconnect")}
          variant="danger"
          onConfirm={disconnect}
          onCancel={() => setConfirmOff(false)}
        />
      </div>,
    );
  }

  return shell(
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{t("tg.code_title")}</p>
        <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>{t("tg.code_sub")}</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          <li>
            {fill(t("tg.step1"), { bot })}
          </li>
          <li>
            {t("tg.step2")}
            {code ? (
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] px-2.5 py-1.5 font-mono text-[12.5px]" style={{ background: "var(--tint)", color: "var(--ink)" }}>
                  {code.command}
                </code>
                <Button size="sm" variant="secondary" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy} aria-live="polite">
                  {copied ? t("tg.copied") : t("tg.copy")}
                </Button>
              </div>
            ) : null}
          </li>
          <li>{t("tg.step3")}</li>
        </ol>
        {code ? (
          <p className="mt-2 text-[12px]" style={{ color: "var(--ink-3)" }} role="status" aria-live="polite">
            {fill(t("tg.code_expires"), { time: formatDate(code.expiresAt, lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })}
            {" · "}{t("tg.waiting")}
          </p>
        ) : null}
        <Button className="mt-3" size="sm" variant={code ? "secondary" : "primary"} icon={<Link2 size={14} />} onClick={getCode} loading={busy === "code"}>
          {code ? t("tg.new_code") : t("tg.get_code")}
        </Button>
      </div>
      <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <p className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{t("tg.name_title")}</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void linkByName();
          }}
        >
          <TextInput className="min-w-[12rem] flex-1" label={t("tg.name_label")} value={name} onChange={setName} placeholder={t("tg.name_ph")} autoComplete="off" />
          <Button type="submit" size="md" disabled={!name.trim()} loading={busy === "name"}>
            {t("tg.connect")}
          </Button>
        </form>
        {nameError ? (
          <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--danger)" }} role="alert">{nameError}</p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("tg.name_hint")}</p>
        )}
      </div>
    </div>,
  );
}
