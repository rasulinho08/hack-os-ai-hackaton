import type { ChannelSummary } from "@/lib/chat";
import { fill } from "@/lib/i18n/fill";

type T = (key: string) => string;

/** A channel's name and the line under it, for this reader. */
export function channelLabel(c: ChannelSummary, organizer: boolean, t: T): { title: string; subtitle: string } {
  switch (c.kind) {
    case "team":
      return {
        title: c.teamName || t("ch.kind.team"),
        subtitle: organizer ? t("ch.sub.team_org") : t("ch.sub.team"),
      };
    case "support":
      return organizer
        ? { title: c.personName || t("ch.kind.support_person"), subtitle: fill(t("ch.sub.support_org"), { name: c.personName || t("ch.someone") }) }
        : { title: t("ch.kind.support"), subtitle: t("ch.sub.support") };
    case "ticket":
      return { title: c.ticketTopic || t("ch.kind.ticket"), subtitle: t("ch.sub.ticket") };
    default:
      return { title: t("ch.kind.general"), subtitle: t("ch.sub.general") };
  }
}
