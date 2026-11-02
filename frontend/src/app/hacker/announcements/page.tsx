"use client";

import { useCallback } from "react";
import { MemberAnnouncements } from "@/components/announcements/MemberAnnouncements";
import { useTranslation } from "@/contexts/LanguageContext";
import { resolveActiveEventId } from "@/lib/resolveEventId";
import { myEventsAs } from "@/lib/workspaces";

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  // The event the participant is working in; the API shows only what is meant for them.
  const loadEventIds = useCallback(async () => {
    const mine = await myEventsAs("participant").catch(() => []);
    return mine.length ? [mine[0].id] : [await resolveActiveEventId()];
  }, []);
  return (
    <MemberAnnouncements
      loadEventIds={loadEventIds}
      title={t("hacker.announcements.title")}
      subtitle={t("hacker.announcements.subtitle")}
      empty={t("hacker.announcements.empty")}
    />
  );
}
