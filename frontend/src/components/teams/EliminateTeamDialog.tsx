"use client";

/**
 * Eliminating a team takes it out of the competition without deleting
 * anything: its members' status becomes "eliminated" (they see why, from the
 * reason given here) and the organiser can restore it later.
 */

import { useState } from "react";
import { Ban } from "lucide-react";
import { Modal } from "@/components/ds/overlays";
import { Button } from "@/components/ds/primitives";
import { TextArea } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { fill } from "@/lib/i18n/fill";

export function EliminateTeamDialog({
  team,
  busy,
  onConfirm,
  onClose,
}: {
  team: { id: number; name: string } | null;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The parent keys this dialog by team, so each team starts with an empty reason.
  const [reason, setReason] = useState("");

  return (
    <Modal
      open={Boolean(team)}
      onClose={() => !busy && onClose()}
      title={team ? fill(t("tm.eliminate_t"), { team: team.name }) : ""}
      description={t("tm.eliminate_b")}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("tm.keep")}</Button>
          <Button size="sm" variant="danger" icon={<Ban size={14} />} loading={busy} disabled={busy} onClick={() => onConfirm(reason.trim())}>
            {t("tm.eliminate_confirm")}
          </Button>
        </div>
      }
    >
      <TextArea label={t("tm.eliminate_reason")} value={reason} onChange={setReason} rows={3} maxLength={500} />
    </Modal>
  );
}
