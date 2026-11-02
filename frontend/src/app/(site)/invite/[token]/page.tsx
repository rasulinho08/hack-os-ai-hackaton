"use client";

/**
 * Accepting an invitation to a customer's account.
 *
 * The page has to work for somebody who is not signed in, who is signed in as
 * the wrong person, or who has no account at all — so it reads the invite
 * before asking for anything. That read is a public endpoint returning only
 * the organisation's name and the address invited, both of which the recipient
 * already knows.
 *
 * The four dead ends (used, withdrawn, expired, not-valid) each get their own
 * sentence. "Something went wrong" here means a person is locked out of their
 * colleague's account with no idea whether to ask for a new link or check
 * which address they used.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Building2, Check, LogIn } from "lucide-react";
import { Button, Card, Eyebrow, SectionTitle } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { acceptInvite, peekInvite, type InvitePreview } from "@/lib/tenancy";

interface Me {
  id: number;
  email?: string;
  full_name?: string;
}

/** The dead ends, each with its own sentence (acct.inv.<state>_title / _body). */
const DEAD_ENDS = new Set(["accepted", "revoked", "expired"]);

/** A translated sentence with {placeholders} filled by elements (an address in bold, say). */
function rich(text: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return m && m[1] in parts ? <span key={i}>{parts[m[1]]}</span> : piece;
  });
}

export default function InvitePage() {
  const { t } = useTranslation();
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token ?? "");

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  /* Runs once per token. The two reads are independent: the invitation is
     public, and being signed out is an ordinary state here rather than a
     failure. State is only written once both settle, in the promise callback,
     so nothing re-renders synchronously inside the effect. */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.allSettled([peekInvite(token), apiGet<Me>("/api/auth/me")]).then(
      ([previewResult, meResult]) => {
        if (cancelled) return;
        if (previewResult.status === "fulfilled") setInvite(previewResult.value);
        else setNotFound(true);
        setMe(
          meResult.status === "fulfilled" && meResult.value?.email ? meResult.value : null,
        );
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const result = await acceptInvite(token);
      setJoined(result.customerName);
      // The role changed server-side; the cookie the shell reads has not.
      // A full navigation re-reads it rather than leaving the old menu up.
      window.setTimeout(() => {
        window.location.href = "/account/team";
      }, 1400);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : t("acct.inv.accept_failed"));
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="hh-skeleton h-7 w-56 rounded" />
        <Card className="mt-6">
          <div className="hh-skeleton h-4 w-3/4 rounded" />
          <div className="hh-skeleton mt-3 h-4 w-1/2 rounded" />
        </Card>
      </Shell>
    );
  }

  if (notFound || !invite) {
    return (
      <Shell>
        <SectionTitle as="h1">{t("acct.inv.invalid_title")}</SectionTitle>
        <Card className="mt-6">
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {t("acct.inv.invalid_body")}
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex min-h-10 items-center gap-2 text-[14px] font-medium"
            style={{ color: "var(--accent)" }}
          >
            {t("acct.inv.home")} <ArrowRight size={14} />
          </Link>
        </Card>
      </Shell>
    );
  }

  if (DEAD_ENDS.has(invite.state)) {
    return (
      <Shell>
        <SectionTitle as="h1">{t(`acct.inv.${invite.state}_title`)}</SectionTitle>
        <Card className="mt-6">
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {t(`acct.inv.${invite.state}_body`)}
          </p>
          <Link
            href={me ? "/account" : `/signin?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="mt-4 inline-flex min-h-10 items-center gap-2 text-[14px] font-medium"
            style={{ color: "var(--accent)" }}
          >
            {me ? t("acct.inv.to_account") : t("acct.inv.sign_in")} <ArrowRight size={14} />
          </Link>
        </Card>
      </Shell>
    );
  }

  if (joined) {
    return (
      <Shell>
        <SectionTitle as="h1">{fill(t("acct.inv.joined_title"), { org: joined })}</SectionTitle>
        <Card className="mt-6">
          <p className="flex items-center gap-2 text-[15px]" style={{ color: "var(--ink-2)" }}>
            <Check size={16} style={{ color: "var(--ok)" }} />
            {t("acct.inv.taking_you")}
          </p>
        </Card>
      </Shell>
    );
  }

  const wrongAccount =
    me?.email && me.email.toLowerCase() !== invite.email.toLowerCase();
  /* The role in the reader's language; one the app does not know stays as the API named it. */
  const roleWord = (role: string) => {
    const key = `acct.role.${role}`;
    const word = t(key);
    return word === key ? role : word;
  };

  return (
    <Shell>
      <SectionTitle as="h1">{fill(t("acct.inv.join"), { org: invite.customerName })}</SectionTitle>

      <Card className="mt-6">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]"
            style={{ background: "var(--accent-weak)", color: "var(--accent)" }}
          >
            <Building2 size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
              {invite.customerName}
            </p>
            <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
              {fill(t("acct.inv.as_role"), { role: roleWord(invite.grantRole), email: invite.email })}
            </p>
          </div>
        </div>

        <p className="mt-4 text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          {fill(t("acct.inv.explainer"), { org: invite.customerName })}
        </p>

        {/* Not signed in ------------------------------------------------- */}
        {!me && (
          <>
            <p className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
              {rich(t("acct.inv.sign_in_as"), { email: <strong style={{ color: "var(--ink-2)" }}>{invite.email}</strong> })}
            </p>
            <Link
              href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius)] px-5 text-[15px] font-semibold"
              style={{ background: "var(--accent-solid)", color: "#fff" }}
            >
              <LogIn size={15} /> {t("acct.inv.sign_in_to_accept")}
            </Link>
          </>
        )}

        {/* Signed in as somebody else ------------------------------------ */}
        {wrongAccount && (
          <div
            className="mt-5 rounded-[var(--radius)] border p-4"
            style={{ borderColor: "var(--warn-weak)", background: "var(--warn-weak)" }}
          >
            <p className="flex items-start gap-2 text-[14px] leading-relaxed" style={{ color: "var(--ink)" }}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
              <span>
                {rich(t("acct.inv.wrong_account"), { me: <strong>{me?.email}</strong>, email: <strong>{invite.email}</strong> })}
              </span>
            </p>
            <Link
              href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="mt-3 inline-flex min-h-10 items-center gap-2 text-[14px] font-medium"
              style={{ color: "var(--accent)" }}
            >
              {t("acct.inv.switch")} <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* Signed in as the right person --------------------------------- */}
        {me && !wrongAccount && (
          <>
            <Button
              variant="primary"
              size="lg"
              className="mt-5"
              disabled={busy}
              loading={busy}
              onClick={accept}
            >
              {busy ? t("acct.inv.joining") : fill(t("acct.inv.join"), { org: invite.customerName })}
            </Button>
            <button
              type="button"
              onClick={() => router.push("/account")}
              className="ml-3 mt-5 inline-flex min-h-11 items-center text-[14px] font-medium"
              style={{ color: "var(--ink-3)" }}
            >
              {t("acct.inv.not_now")}
            </button>
          </>
        )}

        {failed && (
          <p className="mt-4 text-[13px]" style={{ color: "var(--danger)" }}>
            {failed}
          </p>
        )}
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="border-b" style={{ borderColor: "var(--line)" }}>
      <div className="mx-auto max-w-lg px-5 pb-24 pt-16 sm:pt-24">
        <Eyebrow>{t("acct.inv.eyebrow")}</Eyebrow>
        {children}
      </div>
    </section>
  );
}
