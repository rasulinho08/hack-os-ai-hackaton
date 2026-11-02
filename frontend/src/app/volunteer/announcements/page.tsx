"use client";

import { MemberAnnouncements } from "@/components/announcements/MemberAnnouncements";
import { useTranslation } from "@/contexts/LanguageContext";
import { myEventsAs } from "@/lib/workspaces";

// The volunteer's own events — not the platform's "active" one, which may be another organisation's.
const loadVolunteerEvents = async () => (await myEventsAs("volunteer")).map((e) => e.id);

export default function VolunteerAnnouncements() {
  const { t } = useTranslation();
  return (
    <MemberAnnouncements
      loadEventIds={loadVolunteerEvents}
      title={t("volunteer.announcements.title")}
      staffRole="volunteer"
      empty={t("volunteer.announcements.empty")}
    />
  );
}
