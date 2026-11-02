"use client";

import { MemberAnnouncements } from "@/components/announcements/MemberAnnouncements";
import { useTranslation } from "@/contexts/LanguageContext";
import { resolveMentorEventIds } from "@/lib/resolveEventId";

// Every event the mentor is assigned to (posts on sibling events are not dropped).
export default function MentorAnnouncementsPage() {
  const { t } = useTranslation();
  return (
    <MemberAnnouncements
      loadEventIds={resolveMentorEventIds}
      title={t("mentor.announcements.title")}
      subtitle={t("mentor.announcements.subtitle")}
      staffRole="mentor"
      empty={t("mentor.announcements.empty")}
    />
  );
}
