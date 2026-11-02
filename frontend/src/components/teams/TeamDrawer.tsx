"use client";

/**
 * One team, as the organiser manages it: members (make lead, move to another
 * team, take off), people to add (approved, without a team), what the team
 * says it is looking for, its join code, and eliminate / restore / delete.
 *
 * The parent keys it by team, so the person picker starts empty for each.
 */

import { useState } from "react";
import { Ban, Copy, Crown, RotateCcw, Trash2, UserMinus, UserPlus } from "lucide-react";
import { Drawer } from "@/components/ds/overlays";
import { Badge, Button } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { fill } from "@/lib/i18n/fill";
import type { AdminTeam, AdminTeamMember, Teamless } from "@/lib/teamsAdmin";

const selectStyle: React.CSSProperties = { borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" };

export function TeamDrawer({
  team,
  teams,
  people,
  maxSize,
  busy,
  onClose,
  onAdd,
  onMove,
  onRemove,
  onMakeLead,
  onEliminate,
  onRestore,
  onDelete,
}: {
  team: AdminTeam | null;
  teams: AdminTeam[];
  people: Teamless[];
  maxSize: number;
  busy?: boolean;
  onClose: () => void;
  onAdd: (team: AdminTeam, userId: number) => void;
  onMove: (member: AdminTeamMember, to: AdminTeam) => void;
  onRemove: (team: AdminTeam, member: AdminTeamMember) => void;
  onMakeLead: (team: AdminTeam, member: AdminTeamMember) => void;
  onEliminate: (team: AdminTeam) => void;
  onRestore: (team: AdminTeam) => void;
  onDelete: (team: AdminTeam) => void;
}) {
  const { t } = useTranslation();
  const [pick, setPick] = useState("");
  const [copied, setCopied] = useState(false);

  if (!team) return <Drawer open={false} onClose={onClose} title="" />;
  const full = team.members.length >= maxSize;
  const targets = teams.filter((x) => x.id !== team.id && x.status === "active" && x.members.length < maxSize);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(team.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the code is on screen to copy by hand */
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={team.name}
      description={fill(t("tm.size"), { n: team.members.length, limit: maxSize })}
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          {team.status === "eliminated" ? (
            <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} onClick={() => onRestore(team)} disabled={busy}>{t("tm.restore")}</Button>
          ) : (
            <Button size="sm" variant="secondary" icon={<Ban size={13} />} onClick={() => onEliminate(team)} disabled={busy}>{t("tm.eliminate")}</Button>
          )}
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} style={{ color: "var(--danger)" }} onClick={() => onDelete(team)} disabled={busy}>{t("tm.delete")}</Button>
        </div>
      }
    >
      <div className="space-y-6 text-[13.5px]">
        <div className="flex flex-wrap items-center gap-2">
          {team.status === "eliminated" ? <Badge tone="danger" dot>{t("tm.status.eliminated")}</Badge> : <Badge tone="ok" dot>{t("tm.status.active")}</Badge>}
          {team.recruiting ? <Badge tone="info">{t("tm.recruiting")}</Badge> : null}
          {full ? <Badge tone="neutral">{t("tm.full")}</Badge> : null}
        </div>

        {team.status === "eliminated" && team.eliminationReason ? (
          <p className="rounded-[var(--radius-sm)] px-3 py-2" style={{ background: "var(--danger-weak)", color: "var(--ink)" }}>
            {fill(t("tm.reason"), { reason: team.eliminationReason })}
          </p>
        ) : null}

        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("tm.drawer.members")}</h3>
          {team.members.length ? (
            <ul className="space-y-1.5">
              {team.members.map((m) => (
                <li key={m.id} className="rounded-[var(--radius-sm)] border px-3 py-2" style={{ borderColor: "var(--line)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-medium" style={{ color: "var(--ink)" }}>
                        {m.isLead ? <Crown size={12} aria-label={t("tm.col.lead")} style={{ color: "var(--warn)" }} /> : null}
                        {m.name}
                      </p>
                      <p className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>{m.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {!m.isLead ? (
                        <Button size="sm" variant="ghost" icon={<Crown size={12} />} onClick={() => onMakeLead(team, m)} disabled={busy}>{t("tm.make_lead")}</Button>
                      ) : null}
                      {targets.length ? (
                        <label className="inline-flex">
                          <span className="sr-only">{t("tm.move_to")}</span>
                          <select
                            value=""
                            disabled={busy}
                            onChange={(e) => {
                              const to = targets.find((x) => String(x.id) === e.target.value);
                              if (to) onMove(m, to);
                            }}
                            className="h-8 max-w-[10rem] rounded-[var(--radius-sm)] border px-2 text-[12.5px]"
                            style={selectStyle}
                          >
                            <option value="">{t("tm.move_to")}</option>
                            {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </label>
                      ) : null}
                      <Button size="sm" variant="ghost" icon={<UserMinus size={12} />} aria-label={t("tm.remove_member")} title={t("tm.remove_member")} onClick={() => onRemove(team, m)} disabled={busy} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--ink-3)" }}>{t("tm.no_members")}</p>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("tm.drawer.add")}</h3>
          <p className="mb-2 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{full ? t("tm.err.TEAM_FULL") : t("tm.drawer.add_hint")}</p>
          {people.length ? (
            <div className="flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">{t("tm.drawer.pick")}</span>
                <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || full}
                  className="h-9 w-full rounded-[var(--radius-sm)] border px-2 text-[13px]" style={selectStyle}>
                  <option value="">{t("tm.drawer.pick")}</option>
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}{p.skills.length ? ` — ${p.skills.slice(0, 3).join(", ")}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="primary" icon={<UserPlus size={13} />} disabled={busy || full || !pick}
                onClick={() => { onAdd(team, Number(pick)); setPick(""); }}>
                {t("tm.add")}
              </Button>
            </div>
          ) : (
            <p className="rounded-[var(--radius-sm)] px-3 py-2" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>{t("tm.drawer.nobody")}</p>
          )}
        </section>

        {team.recruiting || team.wantedSkills.length || team.recruitingNote ? (
          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("tm.drawer.wanted")}</h3>
            {team.wantedSkills.length ? (
              <div className="flex flex-wrap gap-1.5">{team.wantedSkills.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}</div>
            ) : null}
            {team.recruitingNote ? <p className="mt-2" style={{ color: "var(--ink-2)" }}>“{team.recruitingNote}”</p> : null}
          </section>
        ) : null}

        {team.joinCode ? (
          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("tm.drawer.join_code")}</h3>
            <div className="flex items-center gap-2">
              <code className="rounded-[var(--radius-sm)] px-2.5 py-1 font-mono text-[13px]" style={{ background: "var(--tint)", color: "var(--ink)" }}>{team.joinCode}</code>
              <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => void copy()}>{copied ? t("tm.copied") : t("tm.copy")}</Button>
            </div>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
