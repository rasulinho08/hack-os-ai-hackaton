"use client";

/**
 * The owner edits any customer's event page: its name and address, the
 * words, the dates, the place, the cover and logo, how many people it takes,
 * who can find it, its place at the top of the directory, and its status.
 *
 * Saving sends only the fields that changed to /api/owner/events/:id/page,
 * where the builder's own checks run: the owner cannot store a schedule an
 * organiser could not. A new address keeps the old one redirecting. Pinning,
 * the test mark and the lifecycle (publish, unpublish, archive) act at once,
 * each behind a confirmation that says what it does; unpublishing and
 * archiving ask for the event's name. Every change lands in the audit trail.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Archive, ArchiveRestore, CalendarDays, ExternalLink, Eye, EyeOff, FlaskConical, Globe2, ImagePlus, Loader2,
  MapPin, Pin, PinOff, Send, Trash2, Undo2, Users,
} from "lucide-react";
import { Badge, Button, ErrorState } from "@/components/ds/primitives";
import { useToasts } from "@/components/ds/overlays";
import { PageHead } from "../../../_shell";
import { BackLink, DetailSkeleton, OrgLink, PhaseBadge, hrefFor, num } from "../../../_ui";
import {
  Field, Pair, SaveBar, Section, Segmented, SelectInput, TextArea, TextInput, Toggle, TypedConfirm, type SaveState,
} from "../../../_form";
import { ApiError } from "@/lib/api";
import { PLAN_LABEL } from "@/lib/commerce";
import { resolve } from "@/lib/i18n";
import { checklistText, timelineErrorText } from "@/lib/builder/checklist";
import { formatInZone, fromZonedInput, timeZones, zoneLabel } from "@/lib/builder/datetime";
import { uploadFile } from "@/lib/builder/api";
import { ACCEPT_ATTR, ImageError, prepareImage } from "@/lib/imageResize";
import { siteOrigin } from "@/lib/hosts";
import {
  FORMATS, changedFields, cleanSlug, directoryLine, formOf, localProblems, ownerEvents,
  type EditableField, type EventForm, type OwnerEventPage, type Visibility,
} from "@/lib/superadmin/ownerEvents";

const en = (k: string) => resolve("en", k);

const SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "dates", label: "Dates" },
  { id: "place", label: "Place" },
  { id: "look", label: "Cover & logo" },
  { id: "capacity", label: "Capacity" },
  { id: "visibility", label: "Who can find it" },
];

const LIMIT = { name: 255, tagline: 200, description: 30000 };

type Confirming = null | "publish" | "unpublish" | "archive" | "unarchive" | "test" | "slug";

export default function EventEditPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [event, setEvent] = useState<OwnerEventPage | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    ownerEvents.page(id).then(
      (e) => { if (!cancelled) { setEvent(e); setError(null); } },
      (e: unknown) => { if (!cancelled) setError({ status: (e as { status?: number })?.status, message: e instanceof Error ? e.message : "Could not load" }); },
    );
    return () => { cancelled = true; };
  }, [id, nonce]);

  if (!Number.isInteger(id) || id <= 0 || error?.status === 404) {
    return (
      <>
        <BackLink href="/workspace/events">Events</BackLink>
        <PageHead title="Event not found" sub="It may have been removed, or the number in the address is wrong." />
      </>
    );
  }
  if (error && !event) {
    return (
      <>
        <BackLink href={hrefFor.event(id)}>Event</BackLink>
        <ErrorState title="Could not load this event" body={error.message} onRetry={() => setNonce((n) => n + 1)} />
      </>
    );
  }
  if (!event) return <DetailSkeleton />;
  return <Editor key={event.id} initial={event} />;
}

function Editor({ initial }: { initial: OwnerEventPage }) {
  const { push } = useToasts();
  const [event, setEvent] = useState(initial);
  const [original, setOriginal] = useState<EventForm>(() => formOf(initial));
  const [form, setForm] = useState<EventForm>(() => formOf(initial));
  const [serverErrors, setServerErrors] = useState<Partial<Record<string, string>>>({});
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<{ logo: string | null; banner: string | null }>({ logo: initial.logo_url, banner: initial.banner_url });
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const changes = useMemo(() => changedFields(form, original), [form, original]);
  const changedKeys = Object.keys(changes) as EditableField[];
  const dirty = changedKeys.length > 0;
  const local = useMemo(() => localProblems(form), [form]);
  const zones = useMemo(() => timeZones(), []);
  const pageUrl = event.slug ? `${siteOrigin()}/e/${event.slug}` : null;
  const saveState: SaveState = state === "saving" ? "saving" : state === "error" && dirty ? "error" : dirty ? "dirty" : "saved";

  /** A field's message: the API's after a save, else the browser's once the field was touched. */
  const errorOf = (key: EditableField) => serverErrors[key] ?? (touched.has(key) ? local[key] : undefined) ?? null;

  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setTouched((t) => new Set(t).add(key));
    setServerErrors((e) => ({ ...e, [key]: undefined }));
    if (state === "error") setState("dirty");
  };

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const applyEvent = useCallback((next: OwnerEventPage, { resetForm = false }: { resetForm?: boolean } = {}) => {
    setEvent(next);
    if (resetForm) {
      const f = formOf(next);
      setOriginal(f);
      setForm(f);
      setPreviews({ logo: next.logo_url, banner: next.banner_url });
      setTouched(new Set());
    }
  }, []);

  /** The problems the browser can see in the fields being saved; false (and focus on the first) when there are some. */
  const checkLocal = useCallback((): boolean => {
    const problems = localProblems(form);
    const blocking = Object.keys(problems).filter((k) => k in changes || k === "end_date" || k === "start_date");
    if (!blocking.length) return true;
    setTouched((t) => new Set([...t, ...blocking]));
    setState("error");
    setMessage(`Check ${blocking.length === 1 ? "one field" : `${blocking.length} fields`} before saving.`);
    document.getElementById(`ev-${blocking[0]}`)?.focus();
    return false;
  }, [changes, form]);

  const save = useCallback(async () => {
    if (!checkLocal()) return;
    setState("saving");
    setMessage(null);
    try {
      const out = await ownerEvents.save(event.id, changes);
      applyEvent(out.event, { resetForm: true });
      setServerErrors({});
      setState("saved");
      push(out.changed.length ? `Saved ${out.changed.length} change${out.changed.length === 1 ? "" : "s"} to the event page.` : "Nothing needed saving.");
    } catch (err) {
      setState("error");
      if (err instanceof ApiError && err.fieldErrors.length) {
        const next: Record<string, string> = {};
        for (const fe of err.fieldErrors) {
          const timeline = timelineErrorText(fe.field, fe.code, fe.other, en);
          if (!next[fe.field]) next[fe.field] = timeline ?? fe.message ?? "Check this field.";
        }
        setServerErrors(next);
        setMessage(err.summary || "Not saved: check the highlighted fields.");
        document.getElementById(`ev-${err.fieldErrors[0].field}`)?.focus();
      } else {
        setMessage(err instanceof Error ? err.message : "Not saved.");
      }
    }
  }, [applyEvent, changes, checkLocal, event.id, push]);

  const requestSave = useCallback(() => {
    if (!dirty || state === "saving" || !checkLocal()) return;
    // A new address for a page people may already have: say what happens to the old one.
    if ("slug" in changes && event.is_published && original.slug) setConfirming("slug");
    else void save();
  }, [changes, checkLocal, dirty, event.is_published, original.slug, save, state]);

  // ⌘S / Ctrl+S saves.
  const saveRef = useRef(requestSave);
  useEffect(() => { saveRef.current = requestSave; }, [requestSave]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const discard = () => {
    setForm(original);
    setPreviews({ logo: event.logo_url, banner: event.banner_url });
    setServerErrors({});
    setTouched(new Set());
    setState("saved");
    setMessage(null);
  };

  /** One of the actions that act at once (lifecycle, pin, test). */
  const act = async (run: () => Promise<{ event: OwnerEventPage }>, done: string) => {
    setBusy(true);
    try {
      const out = await run();
      applyEvent(out.event, { resetForm: !dirty });
      push(done);
      setConfirming(null);
    } catch (err) {
      const text = err instanceof ApiError && err.code === "NOT_READY"
        ? "It cannot be published yet: see the list under Status."
        : err instanceof Error ? err.message : "That did not work.";
      push(text, "error");
      setConfirming(null);
      // The checklist may have changed: read the event again.
      ownerEvents.page(event.id).then((e) => applyEvent(e)).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const archived = event.archived;

  return (
    <>
      <BackLink href={hrefFor.event(event.id)}>{event.name}</BackLink>
      <PageHead
        title="Edit event page"
        sub={`${event.name} · ${event.customer_name ?? "No organisation"} · #${event.id}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {pageUrl && event.is_published && !archived ? (
              <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium" style={{ borderColor: "var(--line-strong)", color: "var(--ink)", background: "var(--surface)" }}>
                <ExternalLink size={14} aria-hidden="true" /> View page
              </a>
            ) : null}
            <Link prefetch={false} href={`/workspace/audit?eventId=${event.id}`} className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium" style={{ borderColor: "var(--line-strong)", color: "var(--ink)", background: "var(--surface)" }}>
              Audit trail
            </Link>
          </div>
        }
      />

      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
        <PhaseBadge phase={event.phase} />
        <Badge tone={event.is_published ? "ok" : "neutral"} dot>{event.is_published ? "Published" : "Not published"}</Badge>
        {event.visibility !== "public" ? <Badge tone="info">{event.visibility === "invite" ? "Invite only" : "Link only"}</Badge> : null}
        {event.directory_featured ? <Badge tone="brand">Pinned{event.directory_featured_rank ? ` #${event.directory_featured_rank}` : ""}</Badge> : null}
        {event.is_test ? <Badge tone="warn">Test</Badge> : null}
        {event.plan ? <Badge tone="neutral">{PLAN_LABEL[event.plan] ?? event.plan}</Badge> : null}
      </div>

      {archived ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border px-4 py-3" style={{ borderColor: "var(--line-strong)", background: "var(--warn-weak)" }}>
          <p className="text-sm" style={{ color: "var(--ink)" }}>This event is archived: it is read-only and its page is gone. Bring it back to change it.</p>
          <Button size="sm" icon={<ArchiveRestore size={14} />} onClick={() => setConfirming("unarchive")}>Bring back</Button>
        </div>
      ) : null}

      <nav aria-label="Sections" className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-8 items-center rounded-full border px-3 text-[12.5px] font-medium hover:bg-[var(--tint)]" style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)" }}>
                {s.label}
              </a>
            </li>
          ))}
          <li>
            <a href="#status" className="inline-flex min-h-8 items-center rounded-full border px-3 text-[12.5px] font-medium hover:bg-[var(--tint)]" style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)" }}>
              Status
            </a>
          </li>
        </ul>
      </nav>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <fieldset disabled={archived} className="min-w-0 space-y-5">
          <legend className="sr-only">The event page</legend>

          <Section id="basics" title="Basics" description="The name and the words at the top of the page, and the page's address.">
            <Field label="Event name" htmlFor="ev-name" error={errorOf("name")} counter={{ value: form.name.length, max: LIMIT.name }}>
              <TextInput id="ev-name" value={form.name} invalid={Boolean(errorOf("name"))} maxLength={LIMIT.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field
              label="Page address"
              htmlFor="ev-slug"
              error={errorOf("slug")}
              hint={
                form.slug !== original.slug && original.slug
                  ? <>The old address <code>/e/{original.slug}</code> will keep leading here.</>
                  : event.old_slugs.length
                    ? <>Also reached from {event.old_slugs.map((o) => `/e/${o.slug}`).join(", ")}.</>
                    : "Lowercase letters, digits and dashes."
              }
            >
              <TextInput id="ev-slug" prefix="/e/" value={form.slug} invalid={Boolean(errorOf("slug"))} maxLength={80} spellCheck={false} onChange={(e) => set("slug", cleanSlug(e.target.value))} />
            </Field>
            <Field label="Short description" htmlFor="ev-tagline" optional error={errorOf("tagline")} counter={{ value: form.tagline.length, max: LIMIT.tagline }} hint="One line under the name, and on the directory card.">
              <TextInput id="ev-tagline" value={form.tagline} maxLength={LIMIT.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="ev-description" optional error={errorOf("description")} hint="What the event is about, who it is for, what to expect. Line breaks are kept.">
              <TextArea id="ev-description" rows={8} value={form.description} maxLength={LIMIT.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </Section>

          <Section
            id="dates"
            title="Dates"
            description={<>Times are read in the event&apos;s time zone ({zoneLabel(form.timezone)}). The builder&apos;s rules apply: the event ends after it starts, registration closes before the end.</>}
          >
            <Field label="Time zone" htmlFor="ev-timezone" error={errorOf("timezone")} hint={form.timezone !== original.timezone ? "The times below stay on the clock; they become moments in the new zone." : undefined}>
              <SelectInput id="ev-timezone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")} ({zoneLabel(z)})</option>)}
              </SelectInput>
            </Field>
            <Pair>
              <Field label="Starts" htmlFor="ev-start_date" error={errorOf("start_date")}>
                <TextInput id="ev-start_date" type="datetime-local" value={form.start_date} invalid={Boolean(errorOf("start_date"))} onChange={(e) => set("start_date", e.target.value)} />
              </Field>
              <Field label="Ends" htmlFor="ev-end_date" error={errorOf("end_date")}>
                <TextInput id="ev-end_date" type="datetime-local" value={form.end_date} invalid={Boolean(errorOf("end_date"))} onChange={(e) => set("end_date", e.target.value)} />
              </Field>
            </Pair>
            <Pair>
              <Field label="Registration opens" htmlFor="ev-registration_start" optional error={errorOf("registration_start")} hint="Empty: open as soon as the event is published.">
                <TextInput id="ev-registration_start" type="datetime-local" value={form.registration_start} invalid={Boolean(errorOf("registration_start"))} onChange={(e) => set("registration_start", e.target.value)} />
              </Field>
              <Field label="Registration closes" htmlFor="ev-registration_end" optional error={errorOf("registration_end")} hint="Empty: open until the event starts.">
                <TextInput id="ev-registration_end" type="datetime-local" value={form.registration_end} invalid={Boolean(errorOf("registration_end"))} onChange={(e) => set("registration_end", e.target.value)} />
              </Field>
            </Pair>
          </Section>

          <Section id="place" title="Place" description="Where it happens. An online event shows no venue on its page.">
            <Segmented<typeof form.format>
              label="Format"
              value={form.format}
              onChange={(v) => set("format", v)}
              options={FORMATS.map((f) => ({ value: f, label: f === "offline" ? "In person" : f === "online" ? "Online" : "Hybrid" }))}
            />
            {form.format !== "online" ? (
              <>
                <Pair>
                  <Field label="Venue" htmlFor="ev-venue_name" optional error={errorOf("venue_name")}>
                    <TextInput id="ev-venue_name" value={form.venue_name} maxLength={200} onChange={(e) => set("venue_name", e.target.value)} />
                  </Field>
                  <Field label="Street address" htmlFor="ev-venue_address" optional error={errorOf("venue_address")}>
                    <TextInput id="ev-venue_address" value={form.venue_address} maxLength={300} onChange={(e) => set("venue_address", e.target.value)} />
                  </Field>
                </Pair>
                <Pair>
                  <Field label="City" htmlFor="ev-city" optional error={errorOf("city")}>
                    <TextInput id="ev-city" value={form.city} maxLength={100} onChange={(e) => set("city", e.target.value)} />
                  </Field>
                  <Field label="Country" htmlFor="ev-country" optional error={errorOf("country")} hint="Two letters, like AZ.">
                    <TextInput id="ev-country" value={form.country} maxLength={2} className="uppercase" invalid={Boolean(errorOf("country"))} onChange={(e) => set("country", e.target.value.toUpperCase())} />
                  </Field>
                </Pair>
                <Field label="Map link" htmlFor="ev-map_url" optional error={errorOf("map_url")}>
                  <TextInput id="ev-map_url" type="url" inputMode="url" value={form.map_url} placeholder="https://maps.google.com/…" invalid={Boolean(errorOf("map_url"))} onChange={(e) => set("map_url", e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label="City" htmlFor="ev-city" optional error={errorOf("city")} hint="Optional for an online event: where the organisers are.">
                <TextInput id="ev-city" value={form.city} maxLength={100} onChange={(e) => set("city", e.target.value)} />
              </Field>
            )}
          </Section>

          <Section
            id="look"
            title="Cover & logo"
            description={
              event.branded
                ? "Shown on the page and the directory card. Photos are made smaller in the browser before they are sent."
                : <>This event&apos;s plan does not include its own look, so the page shows the HackOS look until the plan changes. The images are kept.</>
            }
          >
            <ImageField
              label="Cover"
              hint="Wide, at least 1600 × 800. Up to 3 MB."
              eventId={event.id}
              purpose="event_banner"
              maxSide={2400}
              url={previews.banner}
              wide
              onUploaded={(fileId, url) => { set("banner_file_id", fileId); setPreviews((p) => ({ ...p, banner: url })); }}
              onRemove={() => { set("banner_file_id", null); setPreviews((p) => ({ ...p, banner: null })); }}
              error={errorOf("banner_file_id")}
            />
            <ImageField
              label="Logo"
              hint="Square, at least 256 × 256. Up to 1 MB."
              eventId={event.id}
              purpose="event_logo"
              maxSide={512}
              url={previews.logo}
              onUploaded={(fileId, url) => { set("logo_file_id", fileId); setPreviews((p) => ({ ...p, logo: url })); }}
              onRemove={() => { set("logo_file_id", null); setPreviews((p) => ({ ...p, logo: null })); }}
              error={errorOf("logo_file_id")}
            />
          </Section>

          <Section id="capacity" title="Capacity" description={`${num(event.participants)} registered so far.`}>
            <Field label="Places" htmlFor="ev-max_participants" optional error={errorOf("max_participants")} hint="Empty: no limit (the plan's own limit still applies).">
              <TextInput id="ev-max_participants" inputMode="numeric" value={form.max_participants} invalid={Boolean(errorOf("max_participants"))} onChange={(e) => set("max_participants", e.target.value.replace(/[^\d]/g, "").slice(0, 6))} className="sm:max-w-[12rem]" />
            </Field>
            <Toggle
              id="ev-waitlist_enabled"
              checked={form.waitlist_enabled}
              onChange={(v) => set("waitlist_enabled", v)}
              label="Waiting list when full"
              description="People who register after the places are taken wait, and move up when someone leaves."
            />
          </Section>

          <Section id="visibility" title="Who can find it" description="Who may open the page, and whether it is listed in the HackOS directory at /hackathons.">
            <Segmented<Visibility>
              label="Who can open the page"
              value={form.visibility}
              onChange={(v) => set("visibility", v)}
              options={[
                { value: "public", label: "Public", hint: "Anyone; can be listed" },
                { value: "private", label: "Link only", hint: "Not listed or indexed" },
                { value: "invite", label: "Invite only", hint: "Only invited people register" },
              ]}
            />
            <Toggle
              id="ev-directory_listed"
              checked={form.directory_listed}
              onChange={(v) => set("directory_listed", v)}
              disabled={form.visibility !== "public"}
              label="Show in HackOS directory"
              description={form.visibility === "public" ? "The organiser's switch. A public, published event with it on is listed on /hackathons." : "Only a public event can be listed."}
            />
          </Section>
        </fieldset>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-20 xl:self-start">
          <PreviewCard event={event} form={form} previews={previews} pageUrl={pageUrl} />
          <DirectoryPanel event={event} busy={busy} onAct={act} />
          <StatusPanel event={event} busy={busy} onConfirm={setConfirming} onUnmarkTest={() => void act(() => ownerEvents.flags(event.id, { isTest: false }), "No longer marked as a test.")} />
        </aside>
      </div>

      {!archived ? (
        <SaveBar state={saveState} message={message} onSave={requestSave} onDiscard={discard} count={changedKeys.length} />
      ) : null}

      <TypedConfirm
        open={confirming === "slug"}
        onClose={() => setConfirming(null)}
        onConfirm={() => { setConfirming(null); void save(); }}
        title="Change the page address?"
        confirmLabel="Change and save"
        body={<>The page moves from <code>/e/{original.slug}</code> to <code>/e/{form.slug.trim()}</code>. Links people already have keep working: the old address redirects to the new one, and no other event can take it.</>}
      />
      <TypedConfirm
        open={confirming === "publish"}
        onClose={() => setConfirming(null)}
        busy={busy}
        onConfirm={() => void act(() => ownerEvents.publish(event.id), "Published. The page is live.")}
        title="Publish this event?"
        confirmLabel="Publish"
        body={<>The page goes live{event.directory_listed && event.visibility === "public" && !event.is_test ? " and the event is listed on /hackathons" : ""}. If the event has not used one yet, it takes an event from {event.customer_name ?? "its organisation"}&apos;s plan, as when the organiser publishes.</>}
      />
      <TypedConfirm
        open={confirming === "unpublish"}
        onClose={() => setConfirming(null)}
        busy={busy}
        destructive
        phrase={event.name}
        onConfirm={() => void act(() => ownerEvents.unpublish(event.id), "Unpublished. The page is no longer public.")}
        title="Unpublish this event?"
        confirmLabel="Unpublish"
        body={<>The page stops answering and the event leaves the directory. Registrations, teams and projects stay; the organiser can publish it again.</>}
      />
      <TypedConfirm
        open={confirming === "archive"}
        onClose={() => setConfirming(null)}
        busy={busy}
        destructive
        phrase={event.name}
        onConfirm={() => void act(() => ownerEvents.archive(event.id), "Archived. Nothing was deleted.")}
        title="Archive this event?"
        confirmLabel="Archive"
        body={<>The event becomes read-only and its page is taken down. Nothing is deleted: people, teams, projects and results stay, and it can be brought back.</>}
      />
      <TypedConfirm
        open={confirming === "unarchive"}
        onClose={() => setConfirming(null)}
        busy={busy}
        onConfirm={() => void act(() => ownerEvents.unarchive(event.id), "Back from the archive.")}
        title="Bring this event back?"
        confirmLabel="Bring back"
        body={event.is_published ? "It can be changed again and its page answers again." : "It can be changed again. It stays unpublished."}
      />
      <TypedConfirm
        open={confirming === "test"}
        onClose={() => setConfirming(null)}
        busy={busy}
        onConfirm={() => void act(() => ownerEvents.flags(event.id, { isTest: true }), "Marked as a test.")}
        title="Mark as a test?"
        confirmLabel="Mark as test"
        body={<>It leaves the directory and the sitemap, its pin is removed, and it stops counting in the public figures and the console&apos;s analytics. The page itself keeps working. You can take the mark off at any time.</>}
      />
    </>
  );
}

/* ── Side panels ───────────────────────────────────────────────────────── */

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{title}</h2>
        {action}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/** The directory card, as it will look with the form's words, and the way to the live page. */
function PreviewCard({ event, form, previews, pageUrl }: { event: OwnerEventPage; form: EventForm; previews: { logo: string | null; banner: string | null }; pageUrl: string | null }) {
  const startIso = form.start_date ? fromZonedInput(form.start_date, form.timezone) : null;
  const endIso = form.end_date ? fromZonedInput(form.end_date, form.timezone) : null;
  const when = startIso ? `${formatInZone(startIso, form.timezone, "en", { hour: undefined, minute: undefined })}${endIso ? ` – ${formatInZone(endIso, form.timezone, "en", { hour: undefined, minute: undefined })}` : ""}` : "No dates";
  const place = form.format === "online" ? "Online" : [form.venue_name, form.city].filter(Boolean).join(", ") || (form.format === "hybrid" ? "Hybrid" : "In person");
  const slug = form.slug.trim() || event.slug;
  return (
    <Panel
      title="Preview"
      action={pageUrl && event.is_published && !event.archived ? (
        <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[12px] font-medium hover:underline" style={{ color: "var(--accent)" }}>
          Live page <ExternalLink size={12} aria-hidden="true" />
        </a>
      ) : <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>Not live</span>}
    >
      <div className="overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--line)" }}>
        <div className="relative aspect-[16/8]" style={{ background: "var(--tint)" }}>
          {previews.banner ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previews.banner} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono-ui)" }}>No cover</div>
          )}
          {previews.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previews.logo} alt="" className="absolute bottom-2 left-2 h-10 w-10 rounded-[8px] border object-cover" style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }} />
          ) : null}
        </div>
        <div className="space-y-1.5 p-3">
          <p className="text-[14px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>{form.name || "Untitled event"}</p>
          {form.tagline ? <p className="line-clamp-2 text-[12.5px]" style={{ color: "var(--ink-2)" }}>{form.tagline}</p> : null}
          <p className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}><CalendarDays size={12} aria-hidden="true" /> {when}</p>
          <p className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>{form.format === "online" ? <Globe2 size={12} aria-hidden="true" /> : <MapPin size={12} aria-hidden="true" />} {place}</p>
          <p className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}><Users size={12} aria-hidden="true" /> {form.max_participants ? `${num(Number(form.max_participants))} places` : "No limit"}</p>
        </div>
      </div>
      <p className="mt-3 truncate text-[12px]" style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono-ui)" }} title={`/e/${slug}`}>/e/{slug}</p>
      {event.customer_id ? (
        <p className="mt-1 text-[12px]" style={{ color: "var(--ink-3)" }}>Organisation: <OrgLink id={event.customer_id} name={event.customer_name} /></p>
      ) : null}
    </Panel>
  );
}

/** Listed or not and why; the owner's pin and its position. */
function DirectoryPanel({ event, busy, onAct }: { event: OwnerEventPage; busy: boolean; onAct: (run: () => Promise<{ event: OwnerEventPage }>, done: string) => Promise<void> }) {
  const [rank, setRank] = useState(event.directory_featured_rank ? String(event.directory_featured_rank) : "");
  const [seen, setSeen] = useState(event.directory_featured_rank);
  if (seen !== event.directory_featured_rank) {
    setSeen(event.directory_featured_rank);
    setRank(event.directory_featured_rank ? String(event.directory_featured_rank) : "");
  }
  const rankValue = rank.trim() ? Number(rank) : null;
  const rankOk = rankValue == null || (Number.isInteger(rankValue) && rankValue >= 1 && rankValue <= 999);
  const listedNow = event.directory.listed;
  return (
    <Panel title="Directory">
      <p className="flex items-start gap-2 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {listedNow ? <Eye size={14} className="mt-[3px] shrink-0" aria-hidden="true" style={{ color: "var(--ok)" }} /> : <EyeOff size={14} className="mt-[3px] shrink-0" aria-hidden="true" style={{ color: "var(--ink-3)" }} />}
        <span>{directoryLine(event)}</span>
      </p>
      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        {event.directory_featured ? (
          <>
            <label htmlFor="ev-rank" className="mb-1.5 block text-[12.5px] font-medium" style={{ color: "var(--ink)" }}>Position among pinned events</label>
            <div className="flex gap-2">
              <TextInput id="ev-rank" inputMode="numeric" value={rank} placeholder="Last" invalid={!rankOk} onChange={(e) => setRank(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} className="min-h-9 w-24" />
              <Button size="sm" disabled={busy || !rankOk || rankValue === event.directory_featured_rank} onClick={() => void onAct(() => ownerEvents.flags(event.id, { featuredRank: rankValue }), rankValue ? `Pinned at position ${rankValue}.` : "Pinned after the numbered ones.")}>
                Save
              </Button>
            </div>
            <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>1 comes first. Empty: after the numbered ones. A pinned event drops back once it is over.</p>
            <Button size="sm" variant="ghost" className="mt-2" icon={<PinOff size={14} />} disabled={busy} onClick={() => void onAct(() => ownerEvents.flags(event.id, { featured: false }), "Unpinned.")}>
              Unpin
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" icon={<Pin size={14} />} disabled={busy || event.is_test} onClick={() => void onAct(() => ownerEvents.flags(event.id, { featured: true }), listedNow ? "Pinned to the top of /hackathons." : "Pinned. It shows at the top once it is listed.")}>
              Pin to the top of /hackathons
            </Button>
            <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
              {event.is_test ? "A test event cannot be pinned." : "Pinning never lists an event by itself: it must be published, public and listed."}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function StatusPanel({ event, busy, onConfirm, onUnmarkTest }: { event: OwnerEventPage; busy: boolean; onConfirm: (c: Confirming) => void; onUnmarkTest: () => void }) {
  const errors = event.checklist.errors;
  return (
    <section id="status" className="scroll-mt-24">
      <Panel title="Status">
        <div className="space-y-3">
          {!event.archived ? (
            event.is_published ? (
              <ActionRow
                title="Published"
                text={event.published_at ? `Live since ${formatInZone(event.published_at, event.timezone, "en")}.` : "The page is live."}
                button={<Button size="sm" variant="ghost" icon={<Undo2 size={14} />} disabled={busy} onClick={() => onConfirm("unpublish")}>Unpublish</Button>}
              />
            ) : (
              <ActionRow
                title="Not published"
                text={event.checklist.ready ? "Ready to go live." : `${errors.length} thing${errors.length === 1 ? "" : "s"} to finish first.`}
                button={<Button size="sm" variant="primary" icon={<Send size={14} />} disabled={busy || !event.checklist.ready} onClick={() => onConfirm("publish")}>Publish</Button>}
              />
            )
          ) : null}
          {!event.is_published && errors.length ? (
            <ul className="space-y-1 rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px]" style={{ background: "var(--warn-weak)", color: "var(--ink)" }}>
              {errors.slice(0, 6).map((e, i) => <li key={i}>· {checklistText(e, en)}</li>)}
              {errors.length > 6 ? <li>· and {errors.length - 6} more in the builder</li> : null}
            </ul>
          ) : null}
          <ActionRow
            title={event.is_test ? "Marked as a test" : "A real event"}
            text={event.is_test ? "Hidden from the directory, the sitemap and every figure." : "Counted in the figures; can be listed."}
            button={event.is_test
              ? <Button size="sm" variant="ghost" icon={<FlaskConical size={14} />} disabled={busy} onClick={onUnmarkTest}>Unmark</Button>
              : <Button size="sm" variant="ghost" icon={<FlaskConical size={14} />} disabled={busy} onClick={() => onConfirm("test")}>Mark as test</Button>}
          />
          <ActionRow
            title={event.archived ? "Archived" : "Archive"}
            text={event.archived ? "Read-only; nothing was deleted." : "Read-only and off the site. Nothing is deleted."}
            button={event.archived
              ? <Button size="sm" variant="ghost" icon={<ArchiveRestore size={14} />} disabled={busy} onClick={() => onConfirm("unarchive")}>Bring back</Button>
              : <Button size="sm" variant="ghost" icon={<Archive size={14} />} disabled={busy} onClick={() => onConfirm("archive")} style={{ color: "var(--danger)" }}>Archive</Button>}
          />
        </div>
      </Panel>
    </section>
  );
}

function ActionRow({ title, text, button }: { title: string; text: string; button: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>{title}</p>
        <p className="text-[12px] leading-snug" style={{ color: "var(--ink-3)" }}>{text}</p>
      </div>
      <div className="shrink-0">{button}</div>
    </div>
  );
}

/* ── Images ────────────────────────────────────────────────────────────── */

function ImageField({
  label, hint, eventId, purpose, maxSide, url, wide = false, onUploaded, onRemove, error,
}: {
  label: string;
  hint: string;
  eventId: number;
  purpose: "event_banner" | "event_logo";
  maxSide: number;
  url: string | null;
  wide?: boolean;
  onUploaded: (fileId: string, url: string) => void;
  onRemove: () => void;
  error?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { push } = useToasts();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setFailed(null);
    try {
      const prepared = await prepareImage(file, { maxSide });
      const stored = await uploadFile(eventId, purpose, prepared.blob, prepared.name);
      onUploaded(stored.id, stored.url || `/api/files/${stored.id}`);
      push(`${label} uploaded. Save to put it on the page.`, "info");
    } catch (err) {
      setFailed(err instanceof ImageError || err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  const id = `ev-${purpose === "event_banner" ? "banner_file_id" : "logo_file_id"}`;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div
        className={`relative shrink-0 overflow-hidden rounded-[var(--radius-sm)] border ${wide ? "aspect-[2/1] w-full sm:w-64" : "h-24 w-24"}`}
        style={{ borderColor: "var(--line-strong)", background: "var(--tint)" }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${label} preview`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center" style={{ color: "var(--ink-3)" }}><ImagePlus size={20} aria-hidden="true" /></span>
        )}
        {uploading ? (
          <span className="absolute inset-0 flex items-center justify-center" style={{ background: "var(--scrim)" }}>
            <Loader2 size={18} className="animate-spin" style={{ color: "#fff" }} aria-label="Uploading" />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>{label}</p>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{hint}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input ref={input} id={id} type="file" accept={ACCEPT_ATTR} className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size="sm" icon={<ImagePlus size={14} />} disabled={uploading} onClick={() => input.current?.click()}>
            {url ? "Replace" : "Upload"}
          </Button>
          {url ? <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={uploading} onClick={onRemove}>Remove</Button> : null}
        </div>
        {failed || error ? <p role="alert" className="mt-1.5 text-[12.5px]" style={{ color: "var(--danger)" }}>{failed || error}</p> : null}
      </div>
    </div>
  );
}
