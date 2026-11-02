"use client";

/**
 * The event builder for one event — a new draft or a published event being
 * edited; both are the same twenty sections. The open section lives in the
 * address (?section=…) so a reload or a shared link lands in the same place.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError } from "@/lib/api";
import { loadCatalog, publishEvent, unpublishEvent } from "@/lib/builder/api";
import { zoneLabel } from "@/lib/builder/datetime";
import { fromBuilder } from "@/lib/builder/public";
import { SECTION_KEYS } from "@/lib/builder/sections";
import type { Catalog, SectionKey } from "@/lib/builder/types";
import { TIMELINE_TOKEN, useBuilder } from "@/lib/builder/useBuilder";
import { timelineErrorText } from "@/lib/builder/checklist";
import { enterEventWorkspace } from "@/lib/workspaces";
import { BuilderShell } from "@/components/builder/BuilderShell";
import { Drawer } from "@/components/ds/overlays";
import { EventPublicView } from "@/components/event-page/EventPublicView";
import type { SectionCtx } from "@/components/builder/sections/context";
import { BasicsSection, BrandSection, PlaceSection, ScheduleSection } from "@/components/builder/sections/basics";
import { EligibilitySection, FormSection, RegistrationSection } from "@/components/builder/sections/people";
import { PrizesSection, SponsorsSection, TracksSection } from "@/components/builder/sections/content";
import { JudgesSection, JudgingSection, MentorsSection, VolunteersSection } from "@/components/builder/sections/staff";
import { CertificatesSection, CommunicationSection, PresentationSection, ResourcesSection, SubmissionsSection } from "@/components/builder/sections/day";
import { ShareSection } from "@/components/builder/sections/share";

const RENDER: Record<SectionKey, (ctx: SectionCtx) => React.ReactNode> = {
  basics: (c) => <BasicsSection {...c} />,
  brand: (c) => <BrandSection {...c} />,
  place: (c) => <PlaceSection {...c} />,
  schedule: (c) => <ScheduleSection {...c} />,
  registration: (c) => <RegistrationSection {...c} />,
  eligibility: (c) => <EligibilitySection {...c} />,
  form: (c) => <FormSection {...c} />,
  tracks: (c) => <TracksSection {...c} />,
  prizes: (c) => <PrizesSection {...c} />,
  sponsors: (c) => <SponsorsSection {...c} />,
  judging: (c) => <JudgingSection {...c} />,
  judges: (c) => <JudgesSection {...c} />,
  mentors: (c) => <MentorsSection {...c} />,
  volunteers: (c) => <VolunteersSection {...c} />,
  submissions: (c) => <SubmissionsSection {...c} />,
  presentation: (c) => <PresentationSection {...c} />,
  communication: (c) => <CommunicationSection {...c} />,
  resources: (c) => <ResourcesSection {...c} />,
  certificates: (c) => <CertificatesSection {...c} />,
  share: (c) => <ShareSection {...c} />,
};

export default function EventBuilderRoute() {
  return (
    <Suspense fallback={null}>
      <EventBuilderPage />
    </Suspense>
  );
}

function EventBuilderPage() {
  const params = useParams();
  const search = useSearchParams();
  const eventId = Number(params.id);
  const { t, lang } = useTranslation();
  const b = useBuilder(eventId);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [section, setSection] = useState<SectionKey | null>(null);
  const [preview, setPreview] = useState(false);
  const [publishError, setPublishError] = useState<ApiError | null>(null);

  useEffect(() => {
    loadCatalog().then(setCatalog).catch(() => setCatalog(null));
    void enterEventWorkspace(eventId);
  }, [eventId]);

  // The section from the address, else where the organiser left off, else the first.
  useEffect(() => {
    if (section || !b.data) return;
    const fromUrl = search.get("section");
    const last = b.data.event.builder_state?.last;
    const pick = (fromUrl && SECTION_KEYS.includes(fromUrl as SectionKey) ? fromUrl : last && SECTION_KEYS.includes(last) ? last : "basics") as SectionKey;
    setSection(pick);
  }, [b.data, search, section]);

  useEffect(() => {
    if (!section) return;
    b.markVisited(section);
    const url = new URL(window.location.href);
    if (url.searchParams.get("section") !== section) {
      url.searchParams.set("section", section);
      window.history.replaceState(null, "", url.toString());
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const f = useCallback((key: string, p: Record<string, string | number>) =>
    Object.entries(p).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), t(key)), [t]);

  const onPublish = useCallback(async (): Promise<boolean> => {
    setPublishError(null);
    await b.flush();
    try {
      const next = await publishEvent(eventId);
      b.replace(next);
      setSection("share");
      return true;
    } catch (err) {
      setPublishError(err instanceof ApiError ? err : new ApiError(String(err), 0));
      await b.reload();
      return false;
    }
  }, [b, eventId]);

  const onUnpublish = useCallback(async () => {
    await b.flush();
    try {
      b.replace(await unpublishEvent(eventId));
    } catch (err) {
      setPublishError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    }
  }, [b, eventId]);

  const ctx = useMemo<SectionCtx | null>(() => {
    if (!b.data) return null;
    const ev = b.data.event;
    return {
      b,
      data: b.data,
      ev,
      catalog,
      t,
      lang,
      set: b.setFields,
      err: (field: string) => {
        const e = b.fieldErrors[field];
        if (!e) return null;
        if (e.startsWith(TIMELINE_TOKEN)) {
          const [code, other] = e.slice(TIMELINE_TOKEN.length).split(":");
          return timelineErrorText(field, code, other, t) ?? null;
        }
        return e;
      },
      zone: ev.timezone,
      zoneLabel: zoneLabel(ev.timezone),
      has: (m: string) => b.data!.modules.includes(m),
      f,
    };
  }, [b, catalog, t, lang, f]);

  if (b.loadError) {
    const notFound = b.loadError.status === 404 || b.loadError.status === 403;
    return (
      <div className="flex min-h-dvh items-center justify-center px-4" style={{ background: "var(--surface-sunken)" }}>
        <div className="max-w-md text-center">
          <h1 className="text-[20px] font-semibold" style={{ color: "var(--ink)" }}>{notFound ? t("b.load.not_found") : t("b.load.failed")}</h1>
          <p className="mt-2 text-[14px]" style={{ color: "var(--ink-2)" }}>{notFound ? t("b.load.not_found_body") : b.loadError.message}</p>
          <div className="mt-5 flex justify-center gap-3">
            {!notFound ? <button type="button" onClick={() => void b.reload()} className="rounded-[10px] px-4 py-2 text-[14px] font-semibold text-white" style={{ background: "var(--accent-solid)" }}>{t("b.load.retry")}</button> : null}
            <Link href="/workspaces" className="rounded-[10px] border px-4 py-2 text-[14px] font-medium" style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}>{t("b.shell.back")}</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!b.data || !ctx || !section) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ background: "var(--surface-sunken)" }}>
        <Loader2 className="animate-spin" size={22} style={{ color: "var(--ink-3)" }} aria-label={t("Loading")} />
      </div>
    );
  }

  return (
    <>
      <BuilderShell
        data={b.data}
        section={section}
        onSection={setSection}
        status={b.status}
        savedAt={b.savedAt}
        blocked={b.blocked}
        t={t}
        onPublish={onPublish}
        onUnpublish={onUnpublish}
        onPreview={() => (b.data!.event.is_published ? window.open(`/e/${b.data!.event.slug}`, "_blank", "noopener") : setPreview(true))}
        publishError={publishError}
      >
        {b.fieldErrors._ ? (
          <div role="alert" className="mb-4 rounded-[12px] px-3.5 py-3 text-[13px]" style={{ background: "var(--danger-weak)", color: "var(--ink)" }}>{b.fieldErrors._}</div>
        ) : null}
        {RENDER[section](ctx)}
      </BuilderShell>
      <Drawer open={preview} onClose={() => setPreview(false)} title={t("b.shell.preview_title")}>
        <div className="-mx-5 -my-4">
          <EventPublicView event={fromBuilder(b.data)} preview />
        </div>
      </Drawer>
    </>
  );
}
