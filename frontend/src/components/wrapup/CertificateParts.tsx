"use client";

/**
 * Small pieces every certificate screen shares: how a certificate is named
 * ("Winner — 1st place", "2nd place", "Special prize: Best design"), its icon and its
 * colour.
 */

import { Award, Gavel, GraduationCap, HandHeart, Medal, Sparkles } from "lucide-react";
import type { Tone } from "@/components/ds/primitives";
import { fill } from "@/lib/i18n/fill";
import { ordinal, type CertKind } from "@/lib/certificates";

type T = (key: string) => string;

/** The certificate's name as people read it. */
export function certificateTitle(t: T, lang: string, c: { kind: CertKind; place: number | null; title: string | null }): string {
  // "Winner" only for a place the event gave a prize for (the prize's name is the
  // certificate's title); a ranked place without one is just the place, as the
  // results page lists prize winners only.
  if (c.kind === "winner" && c.place) return fill(t(c.title ? "ct.title.winner_place" : "ct.title.place"), { place: ordinal(lang, c.place) });
  if (c.kind === "winner") return t(c.title ? "ct.kind.winner" : "ct.kind.placed");
  if (c.kind === "special" && c.title) return fill(t("ct.title.special_named"), { prize: c.title });
  return t(`ct.kind.${c.kind}`);
}

export const KIND_TONE: Record<CertKind, Tone> = {
  participation: "info",
  winner: "warn",
  special: "brand",
  judge: "neutral",
  mentor: "ok",
  volunteer: "ok",
};

export function KindIcon({ kind, size = 16 }: { kind: CertKind; size?: number }) {
  const props = { size, "aria-hidden": true } as const;
  switch (kind) {
    case "winner":
      return <Medal {...props} />;
    case "special":
      return <Sparkles {...props} />;
    case "judge":
      return <Gavel {...props} />;
    case "mentor":
      return <GraduationCap {...props} />;
    case "volunteer":
      return <HandHeart {...props} />;
    default:
      return <Award {...props} />;
  }
}
