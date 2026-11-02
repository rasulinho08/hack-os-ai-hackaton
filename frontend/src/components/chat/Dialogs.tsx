"use client";

/**
 * The two questions moderation asks: for how long to mute someone (and why),
 * and why a message is being reported. Removing a message uses the shared
 * ConfirmDialog.
 */

import { useState } from "react";
import { Flag, VolumeX } from "lucide-react";
import { Modal } from "@/components/ds/overlays";
import { Button } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { fill } from "@/lib/i18n/fill";
import { MUTE_CHOICES, muteKey, type MuteChoice } from "@/lib/chat";

function ReasonBox({ value, onChange, label, max }: { value: string; onChange: (v: string) => void; label: string; max: number }) {
  return (
    <label className="block text-[13px]" style={{ color: "var(--ink-2)" }}>
      <span className="font-medium" style={{ color: "var(--ink)" }}>{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        rows={3}
        maxLength={max}
        className="mt-1.5 w-full rounded-[var(--radius-sm)] border px-3 py-2 text-[13.5px] focus-visible:outline-2"
        style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)", outlineColor: "var(--accent)" }}
      />
    </label>
  );
}

export function MuteDialog({
  open, name, busy, onClose, onConfirm,
}: {
  open: boolean;
  name: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (minutes: MuteChoice, reason: string) => void;
}) {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState<MuteChoice>(60);
  const [reason, setReason] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={fill(t("ch.mute_title"), { name })}
      description={t("ch.mute_body")}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t("ch.cancel")}</Button>
          <Button variant="danger" icon={<VolumeX size={14} />} loading={busy} disabled={busy} onClick={() => onConfirm(minutes, reason.trim())}>{t("ch.mute")}</Button>
        </>
      )}
    >
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("ch.mute_for")}</legend>
        {MUTE_CHOICES.map((m) => (
          <label key={String(m)} className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2 text-[13.5px]"
            style={{ borderColor: minutes === m ? "var(--accent-solid)" : "var(--line)", background: minutes === m ? "var(--accent-weak)" : "var(--surface)", color: "var(--ink)" }}>
            <input type="radio" name="mute-for" checked={minutes === m} onChange={() => setMinutes(m)} />
            {t(muteKey(m))}
          </label>
        ))}
      </fieldset>
      <div className="mt-4">
        <ReasonBox value={reason} onChange={setReason} label={t("ch.mute_reason")} max={300} />
      </div>
    </Modal>
  );
}

export function ReportDialog({
  open, busy, onClose, onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("ch.report_title")}
      description={t("ch.report_body")}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t("ch.cancel")}</Button>
          <Button variant="primary" icon={<Flag size={14} />} loading={busy} disabled={busy} onClick={() => onConfirm(reason.trim())}>{t("ch.report_send")}</Button>
        </>
      )}
    >
      <ReasonBox value={reason} onChange={setReason} label={t("ch.report_reason")} max={500} />
    </Modal>
  );
}
