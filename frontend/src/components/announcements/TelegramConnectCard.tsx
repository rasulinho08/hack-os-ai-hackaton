"use client";

/**
 * A person's own Telegram: connect it to get their events' announcements as
 * messages, see that it is connected, or disconnect.
 *
 * Connecting opens t.me/<bot>?start=<one-time code>; pressing Start there is
 * what links the chat, so the card watches for it for two minutes instead of
 * asking the person to come back and press anything.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Unlink } from "lucide-react";
import { Badge, Button, cx } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";

interface MyTelegram {
  configured: boolean;
  botUsername: string | null;
  linked: boolean;
  username: string | null;
  firstName: string | null;
  blocked: boolean;
}

const WATCH_MS = 120_000;
const WATCH_EVERY_MS = 3_000;

export function TelegramConnectCard({ className, compact = false }: { className?: string; compact?: boolean }) {
  // Compact: a tighter card for the top of a list.
  const { t } = useTranslation();
  const { toast } = useToast();
  const [me, setMe] = useState<MyTelegram | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const watchUntil = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<MyTelegram>("/api/telegram/me");
      setMe(d);
      return d;
    } catch {
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a link is open in Telegram, look every few seconds for the connection.
  useEffect(() => {
    if (!link) return undefined;
    const timer = setInterval(async () => {
      if (Date.now() > watchUntil.current) {
        clearInterval(timer);
        return;
      }
      const d = await load();
      if (d?.linked) {
        clearInterval(timer);
        setLink(null);
        toast(t("tgme.done"), "success");
      }
    }, WATCH_EVERY_MS);
    return () => clearInterval(timer);
  }, [link, load, t, toast]);

  const connect = async () => {
    setBusy(true);
    try {
      const d = await apiPost<{ url: string }>("/api/telegram/me/link", {});
      watchUntil.current = Date.now() + WATCH_MS;
      setLink(d.url);
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch {
      toast(t("an.toast.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const d = await apiDelete<MyTelegram>("/api/telegram/me");
      setMe(d);
      toast(t("tgme.removed"), "success");
    } catch {
      toast(t("an.toast.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!me) return null;

  const name = me.username ? `@${me.username}` : me.firstName || "";

  return (
    <section
      className={cx("rounded-[var(--radius)] border", compact ? "px-4 py-3" : "p-4", className)}
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      aria-labelledby="tgme-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--info-weak)", color: "var(--info)" }}
          >
            <Send size={16} />
          </span>
          <div className="min-w-0">
            <h3 id="tgme-title" className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              {t("tgme.title")}
              {me.linked && !me.blocked ? <Badge tone="ok" dot className="ml-2 align-middle">{t("tgme.connected")}</Badge> : null}
            </h3>
            <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {!me.configured ? t("tgme.off") : me.linked ? (name ? fill(t("tgme.connected_as"), { name }) : t("tgme.connected")) : t("tgme.desc")}
            </p>
          </div>
        </div>
        {me.configured ? (
          me.linked ? (
            <Button size="sm" variant="ghost" icon={<Unlink size={14} />} onClick={disconnect} disabled={busy}>
              {t("tgme.disconnect")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<Send size={14} />} onClick={connect} loading={busy}>
              {t("tgme.connect")}
            </Button>
          )
        ) : null}
      </div>
      {me.linked && me.blocked ? (
        <p className="mt-3 rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px]" style={{ background: "var(--warn-weak)", color: "var(--warn)" }} role="status">
          {t("tgme.blocked")}
        </p>
      ) : null}
      {link && !me.linked ? (
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--ink-2)" }} role="status" aria-live="polite">
          {t("tgme.waiting")}{" "}
          <a href={link} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>
            {t("tgme.open_again")}
          </a>
        </p>
      ) : null}
    </section>
  );
}
