"use client";

/**
 * Writing a message: Enter sends, Shift+Enter starts a new line, at most
 * 2000 characters (the count shows near the limit). When the person cannot
 * write here — muted, the channel locked, read-only, an archived event — the
 * box says why instead of failing on send.
 */

import { useId, useRef, useState } from "react";
import { Lock, Send } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { MAX_BODY } from "@/lib/chat";

export function Composer({
  disabledReason, onSend, placeholder,
}: {
  /** Why the person cannot write here; null when they can. */
  disabledReason: string | null;
  /** Resolves true when the words left (or are on their way); false keeps them in the box. */
  onSend: (body: string) => Promise<boolean>;
  placeholder: string;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  if (disabledReason) {
    return (
      <div className="flex items-center gap-2 border-t px-4 py-3 text-[13px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)", background: "var(--surface-sunken)" }} role="status">
        <Lock size={14} aria-hidden="true" />
        {disabledReason}
      </div>
    );
  }

  const trimmed = text.trim();
  const tooLong = text.length > MAX_BODY;

  // The box empties at once: the message shows as "sending…" in the list
  // (and stays there with "send again" if it does not go out).
  const submit = async () => {
    if (!trimmed || tooLong) return;
    const words = text;
    setText("");
    box.current?.focus();
    const ok = await onSend(words.trim());
    // Not even queued: give the words back.
    if (!ok) setText((now) => (now ? now : words));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="border-t px-3 py-3 sm:px-4"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor={`${hintId}-box`}>{t("ch.write_label")}</label>
        <textarea
          id={`${hintId}-box`}
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-describedby={hintId}
          className="max-h-40 min-h-[42px] flex-1 resize-y rounded-[var(--radius-sm)] border px-3 py-2.5 text-[14px] leading-snug focus-visible:outline-2"
          style={{ borderColor: tooLong ? "var(--danger)" : "var(--line-strong)", background: "var(--surface)", color: "var(--ink)", outlineColor: "var(--accent)" }}
        />
        <Button type="submit" variant="primary" icon={<Send size={15} />} disabled={!trimmed || tooLong} aria-label={t("ch.send")}>
          <span className="hidden sm:inline">{t("ch.send")}</span>
        </Button>
      </div>
      <p id={hintId} className="mt-1.5 flex justify-between gap-3 text-[11.5px]" style={{ color: tooLong ? "var(--danger)" : "var(--ink-3)" }}>
        <span className="hidden sm:inline">{t("ch.enter_hint")}</span>
        {text.length > MAX_BODY - 200 ? <span className="tabular-nums">{text.length}/{MAX_BODY}</span> : null}
      </p>
    </form>
  );
}
