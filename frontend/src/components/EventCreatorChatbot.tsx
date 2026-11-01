"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";

type Msg = { role: "user" | "assistant"; content: string };

export function EventCreatorChatbot() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pathname,
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.error || data.message || t("chatbot.error_generic")
        );
      }
      if (!data.reply) throw new Error(t("chatbot.error_generic"));
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply! }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("chatbot.error_generic");
      setError(msg);
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, pathname, t]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Wide screens: in the sidebar's footer corner, clear of every table's
        // row actions. Narrower: bottom right, smaller; the shell leaves room
        // under the content so the last row can scroll clear of it.
        className={`fixed bottom-4 right-4 z-[100] flex h-12 w-12 items-center justify-center rounded-full bg-[#E1003C] text-white shadow-lg shadow-[#E1003C]/30 transition-transform hover:scale-105 hover:bg-[#C00035] lg:bottom-3 lg:left-[204px] lg:right-auto lg:h-11 lg:w-11 ${
          open ? "pointer-events-none opacity-0" : ""
        }`}
        title={t("chatbot.open")}
        aria-label={t("chatbot.open")}
      >
        <MessageCircle size={22} strokeWidth={2} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-end bg-black/40 p-4 sm:items-end sm:justify-end sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chatbot-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="theme-bg-card theme-border theme-text flex max-h-[min(560px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hh-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="text-[#E1003C]" size={18} />
                <h2 id="chatbot-title" className="text-[15px] font-semibold">
                  {t("chatbot.title")}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="theme-text-muted rounded-lg p-1.5 hover:opacity-100"
                aria-label={t("chatbot.close")}
              >
                <X size={20} />
              </button>
            </div>

            <p className="theme-text-muted border-b border-[var(--hh-border)] px-4 py-2 text-[12px] leading-snug">
              {t("chatbot.hint")}
            </p>

            <div
              ref={listRef}
              className="theme-bg-page min-h-[200px] flex-1 space-y-3 overflow-y-auto px-4 py-3"
            >
              {messages.length === 0 && !loading && (
                <p className="theme-text-muted text-[13px]">{t("chatbot.empty")}</p>
              )}
              {messages.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={`max-w-[95%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto bg-[#E1003C]/20 text-[var(--hh-text)]"
                      : "theme-bg-card border border-[var(--hh-border)] theme-text-muted"
                  }`}
                >
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide opacity-70">
                    {m.role === "user" ? t("chatbot.you") : t("chatbot.assistant")}
                  </span>
                  <div className="whitespace-pre-wrap text-[var(--hh-text)]">
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="theme-text-muted flex items-center gap-2 text-[13px]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("chatbot.thinking")}
                </div>
              )}
            </div>

            {error && (
              <p className="border-t border-[var(--hh-border)] px-4 py-2 text-[13px] text-[var(--app-danger)]">
                {error}
              </p>
            )}

            <div className="theme-border border-t p-3">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={t("chatbot.placeholder")}
                  rows={2}
                  className="theme-bg-page theme-text theme-border focus:border-[#E1003C]/50 flex-1 resize-none rounded-xl border px-3 py-2 text-[13px] outline-none placeholder:opacity-50"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={loading || !input.trim()}
                  className="flex h-[52px] w-11 shrink-0 items-center justify-center rounded-xl bg-[#E1003C] text-white transition-colors hover:bg-[#C00035] disabled:opacity-40"
                  aria-label={t("chatbot.send")}
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
