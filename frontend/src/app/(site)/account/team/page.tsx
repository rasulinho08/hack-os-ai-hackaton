"use client";

/**
 * The colleagues on a customer's account.
 *
 * Three things a customer administrator can do here and nowhere else: see who
 * holds a seat, invite somebody, and take a seat back. Everything is scoped by
 * the backend from the session, so this screen never names a customer.
 *
 * Two details worth keeping if this is ever rewritten:
 *
 *   - A seat limit of `null` is rendered in words, never as a number. "No
 *     limit agreed" and "0 seats" are opposite facts and the difference is
 *     invisible if you print the value.
 *   - The invite link is shown even when the mail was sent. SMTP is not
 *     guaranteed on every deployment, and an inviter who can copy the link is
 *     never stuck waiting for a delivery that silently failed.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Mail,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Eyebrow,
  SectionTitle,
  TableSkeleton,
} from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import {
  type Invite,
  type Member,
  type Seats,
  type Team,
  INVITE_STATE_TONE,
  inviteColleague,
  loadTeam,
  removeMember,
  revokeInvite,
} from "@/lib/tenancy";

type T = (key: string) => string;

/** A day in the reader's language, or a dash. */
function useDay() {
  const { lang } = useTranslation();
  return (d?: string | null) =>
    (d ? formatDate(d, lang, { day: "numeric", month: "short", year: "numeric" }) : "") || "—";
}

/*
 * How many seats, in words. A limit of null is "no limit agreed", never a
 * number (see the note at the top of this file).
 */
function seatsInWords(seats: Seats, t: T): string {
  if (seats.limit == null) {
    return seats.used === 1 ? t("acct.team.people_one") : fill(t("acct.team.people_many"), { n: seats.used });
  }
  return fill(t("acct.team.seats_of"), { used: seats.used, limit: seats.limit });
}

/** A role as the API names it, in the reader's language (unknown ones fall back to "Member"). */
function roleLabel(role: string | null | undefined, t: T): string {
  const key = `acct.role.${role ?? ""}`;
  const label = t(key);
  return label === key ? t("acct.team.member") : label;
}

const initials = (name?: string | null, email?: string) =>
  (name || email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

export default function TeamPage() {
  const { t } = useTranslation();
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [noCustomer, setNoCustomer] = useState(false);
  const [nonce, setNonce] = useState(0);

  /*
   * Refetch without blanking what is on screen.
   *
   * Clearing `team` here unmounted the invite form, and with it the panel
   * holding the invitation link — the one thing the inviter needs when mail is
   * not configured, gone half a second after it appeared. A revalidation is
   * not a fresh load and must not be rendered as one.
   */
  const reload = useCallback(() => {
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ email?: string }>("/api/auth/me")
      .then(async (user) => {
        if (cancelled) return;
        if (!user?.email) {
          setAnonymous(true);
          return;
        }
        try {
          const data = await loadTeam();
          if (!cancelled) setTeam(data);
        } catch (e) {
          if (cancelled) return;
          // "You have no customer" is not a failure to load — it is a real
          // answer, and it needs its own screen rather than an error panel.
          if (e instanceof ApiError && e.status === 403) setNoCustomer(true);
          // An empty message is shown as the generic "could not load".
          else setError(e instanceof Error ? e.message : "");
        }
      })
      .catch(() => {
        if (!cancelled) setAnonymous(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (anonymous) {
    return (
      <Shell>
        <SectionTitle as="h1">{t("acct.team.sign_in_title")}</SectionTitle>
        <Link
          href="/signin?next=%2Faccount%2Fteam"
          className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-5 text-[15px] font-semibold"
          style={{ background: "var(--accent-solid)", color: "#fff" }}
        >
          {t("acct.team.sign_in")}
        </Link>
      </Shell>
    );
  }

  if (noCustomer) {
    return (
      <Shell>
        <SectionTitle as="h1">{t("acct.team.no_org_title")}</SectionTitle>
        <Card className="mt-6">
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {t("acct.team.no_org_body")}
          </p>
          <Link
            href="/account"
            className="mt-4 inline-flex min-h-10 items-center gap-2 text-[14px] font-medium"
            style={{ color: "var(--accent)" }}
          >
            <ArrowLeft size={14} /> {t("acct.team.back_account")}
          </Link>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle as="h1">{t("acct.team.title")}</SectionTitle>
        <Link
          href="/account"
          className="inline-flex min-h-10 items-center gap-2 text-[13px] font-medium"
          style={{ color: "var(--ink-2)" }}
        >
          <ArrowLeft size={14} /> {t("acct.team.account_link")}
        </Link>
      </div>

      {error !== null ? (
        <div className="mt-6">
          <ErrorState title={t("acct.team.load_failed")} body={error || t("acct.team.load_failed")} onRetry={reload} />
        </div>
      ) : team === null ? (
        <Card className="mt-6" padded={false}>
          <TableSkeleton rows={4} cols={3} />
        </Card>
      ) : (
        <TeamBody team={team} onChanged={reload} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="border-b" style={{ borderColor: "var(--line)" }}>
      <div className="mx-auto max-w-4xl px-5 pb-24 pt-14 sm:pt-20">
        <Eyebrow>{t("acct.eyebrow")}</Eyebrow>
        {children}
      </div>
    </section>
  );
}

function TeamBody({ team, onChanged }: { team: Team; onChanged: () => void }) {
  const { t } = useTranslation();
  const { seats, members, invites } = team;
  const pending = invites.filter((i) => i.state === "pending");
  const past = invites.filter((i) => i.state !== "pending");
  const full = seats.limit != null && seats.remaining === 0;

  return (
    <>
      {/* ── Seats ───────────────────────────────────────────────── */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-[8px]"
              style={{ background: "var(--tint)", color: "var(--ink-2)" }}
            >
              <Users size={17} />
            </span>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                {seatsInWords(seats, t)}
              </p>
              <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
                {seats.limit == null
                  ? t("acct.team.no_limit")
                  : fill(t("acct.team.seat_counts"), { linked: seats.linked, pending: seats.pending, remaining: seats.remaining })}
              </p>
            </div>
          </div>
          {full && <Badge tone="warn">{t("acct.team.full")}</Badge>}
        </div>

        {seats.limit != null && (
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full"
            style={{ background: "var(--tint)" }}
            role="img"
            aria-label={fill(t("acct.team.seats_used"), { used: seats.used, limit: seats.limit })}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, seats.limit === 0 ? 100 : (seats.used / seats.limit) * 100)}%`,
                background: full ? "var(--warn)" : "var(--accent-solid)",
              }}
            />
          </div>
        )}
      </Card>

      <InviteForm full={full} onInvited={onChanged} />

      {/* ── Members ─────────────────────────────────────────────── */}
      <h2
        className="mt-10 text-[17px] font-semibold"
        style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
      >
        {t("acct.team.people")}
      </h2>
      <Card className="mt-4" padded={false}>
        {members.length === 0 ? (
          <EmptyState
            title={t("acct.team.empty_title")}
            body={t("acct.team.empty_body")}
            icon={<Users size={19} />}
          />
        ) : (
          <ul>
            {members.map((m) => (
              <MemberRow key={m.id} member={m} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </Card>

      {/* ── Invitations ─────────────────────────────────────────── */}
      {(pending.length > 0 || past.length > 0) && (
        <>
          <h2
            className="mt-10 text-[17px] font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
          >
            {t("acct.team.invitations")}
          </h2>
          <Card className="mt-4" padded={false}>
            <ul>
              {[...pending, ...past].map((i) => (
                <InviteRow key={i.id} invite={i} onChanged={onChanged} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function MemberRow({ member, onChanged }: { member: Member; onChanged: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await removeMember(member.id);
      onChanged();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : t("acct.team.release_failed"));
      setBusy(false);
    }
  };

  return (
    <li
      className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-b-0"
      style={{ borderColor: "var(--line)" }}
    >
      {/*
        * Identity takes the whole first line on a phone (`basis-full`) so the
        * badges and the action wrap underneath it. Sharing one line squeezed
        * the address down to "colleag…", which is the one part of the row a
        * reader actually needs to identify the person.
        */}
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ background: "var(--tint)", color: "var(--ink-2)" }}
          aria-hidden="true"
        >
          {initials(member.full_name, member.email)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium" style={{ color: "var(--ink)" }}>
            {member.full_name || member.email}
          </p>
          <p className="truncate text-[13px]" style={{ color: "var(--ink-3)" }}>
            {member.email}
            {member.role_title ? ` · ${member.role_title}` : ""}
          </p>
          {failed && (
            <p className="mt-1 text-[13px]" style={{ color: "var(--danger)" }}>
              {failed}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {member.is_primary && <Badge tone="neutral">{t("acct.team.billing_contact")}</Badge>}
        {member.user_id ? (
          <Badge tone={member.platform_role === "superadmin" ? "ok" : "info"}>
            {roleLabel(member.platform_role, t)}
          </Badge>
        ) : (
          // No account means no seat consumed — worth saying, or the seat
          // count looks wrong next to the length of this list.
          <Badge tone="neutral">{t("acct.team.no_account")}</Badge>
        )}
        {member.user_id && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={remove}
            icon={<UserMinus size={14} />}
            aria-label={fill(t("acct.team.release_aria"), { email: member.email })}
          >
            {busy ? t("acct.team.releasing") : t("acct.team.release")}
          </Button>
        )}
      </div>
    </li>
  );
}

function InviteRow({ invite, onChanged }: { invite: Invite; onChanged: () => void }) {
  const { t } = useTranslation();
  const day = useDay();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const withdraw = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await revokeInvite(invite.id);
      onChanged();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : t("acct.team.withdraw_failed"));
      setBusy(false);
    }
  };

  return (
    <li
      className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-b-0"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--tint)", color: "var(--ink-3)" }}
          aria-hidden="true"
        >
          <Mail size={15} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium" style={{ color: "var(--ink)" }}>
            {invite.email}
          </p>
          <p className="truncate text-[13px]" style={{ color: "var(--ink-3)" }}>
            {invite.state === "pending"
              ? fill(t("acct.team.expires"), { date: day(invite.expires_at) })
              : invite.state === "accepted"
                ? fill(t("acct.team.accepted_on"), { date: day(invite.accepted_at) })
                : fill(t("acct.team.sent_on"), { date: day(invite.created_at) })}
            {invite.invited_by_name ? ` · ${fill(t("acct.team.by"), { name: invite.invited_by_name })}` : ""}
          </p>
          {failed && (
            <p className="mt-1 text-[13px]" style={{ color: "var(--danger)" }}>
              {failed}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={INVITE_STATE_TONE[invite.state]}>{t(`acct.state.${invite.state}`)}</Badge>
        {invite.state === "pending" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={withdraw}
            icon={<X size={14} />}
            aria-label={fill(t("acct.team.withdraw_aria"), { email: invite.email })}
          >
            {busy ? t("acct.team.withdrawing") : t("acct.team.withdraw")}
          </Button>
        )}
      </div>
    </li>
  );
}

function InviteForm({ full, onInvited }: { full: boolean; onInvited: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState<{ url: string; emailed: boolean; to: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFailed(null);
    setSent(null);
    try {
      const result = await inviteColleague({
        email: email.trim(),
        fullName: fullName.trim() || undefined,
      });
      setSent({ url: result.acceptUrl, emailed: result.emailed, to: result.invite.email });
      setEmail("");
      setFullName("");
      onInvited();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : t("acct.team.invite_failed"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard can be blocked; the link is on screen to select by hand */
    }
  };

  return (
    <Card className="mt-4">
      <div className="flex items-center gap-2.5">
        <UserPlus size={17} style={{ color: "var(--ink-3)" }} />
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
          {t("acct.team.invite_title")}
        </h2>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
        {t("acct.team.invite_body")}
      </p>

      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor="invite-email" className="sr-only">
            {t("acct.team.email_label")}
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("acct.team.email_placeholder")}
            className="min-h-11 w-full rounded-[var(--radius)] border px-3.5 text-[15px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface-raised)", color: "var(--ink)" }}
          />
        </div>
        <div>
          <label htmlFor="invite-name" className="sr-only">
            {t("acct.team.name_label")}
          </label>
          <input
            id="invite-name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("acct.team.name_placeholder")}
            className="min-h-11 w-full rounded-[var(--radius)] border px-3.5 text-[15px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface-raised)", color: "var(--ink)" }}
          />
        </div>
        <Button type="submit" disabled={busy || full} icon={<UserPlus size={15} />}>
          {busy ? t("acct.team.sending") : t("acct.team.invite")}
        </Button>
      </form>

      {full && (
        <p className="mt-3 text-[13px]" style={{ color: "var(--warn)" }}>
          {t("acct.team.full_body")}
        </p>
      )}

      {failed && (
        <p className="mt-3 text-[13px]" style={{ color: "var(--danger)" }}>
          {failed}
        </p>
      )}

      {sent && (
        <div
          className="mt-4 rounded-[var(--radius)] border p-4"
          style={{ borderColor: "var(--ok-weak)", background: "var(--ok-weak)" }}
        >
          <p className="flex items-center gap-2 text-[14px] font-medium" style={{ color: "var(--ink)" }}>
            <Check size={15} style={{ color: "var(--ok)" }} />
            {fill(t(sent.emailed ? "acct.team.emailed_to" : "acct.team.ready_for"), { email: sent.to })}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {sent.emailed ? t("acct.team.also_link") : t("acct.team.no_mail")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded-[8px] px-3 py-2 text-[12px]"
              style={{ background: "var(--surface)", color: "var(--ink-2)", fontFamily: "var(--font-mono-ui)" }}
            >
              {sent.url}
            </code>
            <Button size="sm" variant="secondary" onClick={copy} icon={<Copy size={14} />}>
              {copied ? t("acct.team.copied") : t("acct.team.copy")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
