"use client";

/**
 * The organisation page's pricing actions, for the owner:
 *
 *   Grant Community   the free plan for a student club or a non-commercial
 *                     university event. Recorded as a ₼0 order that is
 *                     approved at once (POST /api/customers/:id/community):
 *                     a year with Community's limits and Starter's modules,
 *                     no invoice. Not while one is live.
 *   Launch partner    a code for this organisation alone: −50% for 24
 *                     months, with the prices of the day in its note. The
 *                     "price lock" is that end date and that note; the
 *                     catalogue can still change, so the owner honours the
 *                     note by hand when it does.
 */

import { useState } from "react";
import Link from "next/link";
import { Copy, GraduationCap, Handshake } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { Panel } from "@/components/ds/board";
import { Confirm } from "@/components/ds/overlays";
import { ApiError, apiPost } from "@/lib/api";
import { createCoupon, launchPartnerCoupon, LAUNCH_PARTNER_MONTHS, loadPricing } from "@/lib/superadmin/pricing";

export function PlanGrants({ customer, communityLive, onChanged }: {
  customer: { id: number; name: string };
  communityLive: boolean;
  onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<null | "community" | "partner">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [partner, setPartner] = useState<{ id: number; code: string } | null>(null);

  const grant = async () => {
    setBusy("community");
    setMessage(null);
    try {
      await apiPost(`/api/customers/${customer.id}/community`, {});
      setMessage({ tone: "ok", text: "Community granted for a year. It shows under Bought, with its order." });
      onChanged();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.summary || e.message : "It was not granted." });
    } finally {
      setBusy(null);
    }
  };

  const makePartner = async () => {
    setBusy("partner");
    setMessage(null);
    try {
      const { plans } = await loadPricing();
      const c = await createCoupon(launchPartnerCoupon(customer, plans));
      setPartner({ id: c.id, code: c.code ?? "" });
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.summary || e.message : "The code was not made." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Community and partner pricing">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--ink)" }}>
            <GraduationCap size={15} style={{ color: "var(--accent)" }} /> Community, free
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>
            For a student club or a non-commercial university event: a year with Community&apos;s limits and Starter&apos;s modules. Recorded as a ₼0 order, with no invoice.
          </p>
          <Button className="mt-2" size="sm" disabled={busy !== null || communityLive} loading={busy === "community"} onClick={() => setConfirm(true)}>
            {communityLive ? "Community is live" : "Grant Community…"}
          </Button>
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--ink)" }}>
            <Handshake size={15} style={{ color: "var(--accent)" }} /> Launch partner −50%
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>
            A code for this organisation alone, for {LAUNCH_PARTNER_MONTHS} months, with today&apos;s prices noted as locked. Give it to them; it works for nobody else.
          </p>
          {partner ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-semibold" style={{ color: "var(--ink)" }}>{partner.code}</span>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => navigator.clipboard?.writeText(partner.code).catch(() => {})}>Copy</Button>
              <Link prefetch={false} href={`/workspace/pricing?tab=discounts&coupon=${partner.id}`} className="text-xs hover:underline" style={{ color: "var(--accent)" }}>Open</Link>
            </p>
          ) : (
            <Button className="mt-2" size="sm" disabled={busy !== null} loading={busy === "partner"} onClick={makePartner}>Make a partner code</Button>
          )}
        </div>
      </div>
      {message ? (
        <p role={message.tone === "danger" ? "alert" : "status"} className="mt-3 text-sm" style={{ color: message.tone === "danger" ? "var(--danger)" : "var(--ok)" }}>{message.text}</p>
      ) : null}
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={grant}
        title={`Grant Community to ${customer.name}?`}
        body="A free year on Community: 2 events, 100 participants each, Starter's modules. The organisation goes live, and if it is not set up yet its billing address gets a setup link."
        confirmLabel="Grant Community"
      />
    </Panel>
  );
}
