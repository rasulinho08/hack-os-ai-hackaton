"use client";

/**
 * On the participant's home once the organisers have put photos up: how
 * many there are and the way to the gallery. Renders nothing while there are
 * none, when the plan has no gallery, or when the person may not see it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Images } from "lucide-react";
import { Card, buttonLook } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { galleryApi, galleryPagePath, type GalleryView } from "@/lib/gallery";

export function GalleryCallout({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const [data, setData] = useState<GalleryView | null>(null);

  useEffect(() => {
    let cancelled = false;
    galleryApi.get(eventId)
      .then((v) => { if (!cancelled) setData(v); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [eventId]);

  if (!data || !data.enabled || !data.eventSlug || data.items.length === 0 || data.eventId !== eventId) return null;
  const look = buttonLook("secondary", "sm");
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
          <Images size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{t("gl.callout_title")}</p>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("gl.callout_body")}</p>
        </div>
      </div>
      <Link href={galleryPagePath(data.eventSlug)} className={look.className} style={look.style}>
        {t("gl.callout_cta")}
      </Link>
    </Card>
  );
}
