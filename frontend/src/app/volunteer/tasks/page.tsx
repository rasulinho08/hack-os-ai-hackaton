"use client";

import { VolunteerTaskList } from "@/components/volunteer/VolunteerTaskList";
import { useTranslation } from "@/contexts/LanguageContext";

export default function VolunteerTasksPage() {
  const { t } = useTranslation();
  return <VolunteerTaskList title={t("vt.my_title")} subtitle={t("vt.my_subtitle")} />;
}
