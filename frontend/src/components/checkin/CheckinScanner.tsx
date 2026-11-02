"use client";

/**
 * The scanner at the door, for the organisers (/checkin/scan) and the
 * event's volunteers (/volunteer/scan).
 *
 * The camera reads QR codes with the browser's own barcode reader where
 * there is one (BarcodeDetector: Chrome and Edge on Android, Chrome on
 * macOS), and with jsQR where there is none — Safari on iPhone and iPad,
 * Firefox (lib/qrFallback.ts, loaded only when the camera starts there). A
 * ticket can also be scanned with the phone's own camera app, which opens
 * this page with the code filled in, or the code typed: the box for typing
 * always works and takes a pasted ticket link too.
 *
 * Each result is shown large, in a colour that reads from across a desk —
 * green in, amber already in, red not accepted or not a ticket — and the
 * scanner is ready for the next ticket at once: a typed code is cleared, the
 * camera keeps reading (the same ticket is not read twice in a row), and the
 * result fades after a few seconds so it is never taken for the next
 * person's.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Camera, CameraOff, CheckCircle2, Loader2, ScanLine, XCircle } from "lucide-react";
import { Button, Progress, buttonLook } from "@/components/ds/primitives";
import { Notice, inputStyle } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError, DemoReadOnlyError, isDemoApiEnabled } from "@/lib/api";
import { formatInZone } from "@/lib/builder/datetime";
import {
  checkinApi, checkinErrorKey, clearTicketFromUrl, parseScanInput,
  type CheckinPerson, type CheckinStats, type ScanOutcome,
} from "@/lib/checkin";
import { fill } from "@/lib/i18n/fill";
import { loadJsQrReader } from "@/lib/qrFallback";
import { useEventZone } from "@/lib/useEventZone";

/** How long a result stays up before the scanner shows it is ready again. */
const RESULT_MS = 7000;
/** After a camera read, the next one waits this long (the result is read first). */
const PAUSE_MS = 1800;
/** The same ticket held in front of the camera is not sent again for this long. */
const SAME_TICKET_MS = 8000;
const FRAME_MS = 200;
const STATS_MS = 15_000;

/* ── The browser's barcode reader (not in TypeScript's DOM types yet) ──── */

interface DetectedCode { rawValue: string }
interface BarcodeReader { detect(source: HTMLVideoElement): Promise<DetectedCode[]> }
interface BarcodeReaderClass {
  new (options?: { formats?: string[] }): BarcodeReader;
  getSupportedFormats?: () => Promise<string[]>;
}

function readerClass(): BarcodeReaderClass | null {
  if (typeof window === "undefined") return null;
  const C = (window as unknown as { BarcodeDetector?: BarcodeReaderClass }).BarcodeDetector;
  return typeof C === "function" ? C : null;
}

/**
 * Whether this page may use the camera. A page's Permissions-Policy comes
 * with the page it was loaded as: the scanners allow the camera, the rest of
 * the app does not, and moving between pages inside the app keeps the first
 * one's. Chrome and Edge (the browsers with a barcode reader) can say so;
 * elsewhere the camera request itself answers.
 */
function pageAllowsCamera(): boolean {
  const policy = (document as unknown as { featurePolicy?: { allowsFeature?: (feature: string) => boolean } }).featurePolicy;
  return typeof policy?.allowsFeature === "function" ? policy.allowsFeature("camera") : true;
}

/** Set on the address when the scanner is loaded afresh to start the camera. */
const CAMERA_PARAM = "camera";

// Any browser with a camera API: without a barcode reader of its own, jsQR reads the frames.
const cameraPossible = () =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

/** The browser's own QR reader when it has one that reads QR codes, else null. */
async function nativeReader(): Promise<BarcodeReader | null> {
  const Reader = readerClass();
  if (!Reader) return null;
  try {
    if (Reader.getSupportedFormats && !(await Reader.getSupportedFormats()).includes("qr_code")) return null;
    return new Reader({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}
const noSubscribe = () => () => {};

type Camera = "idle" | "starting" | "on" | "unsupported" | "denied" | "failed";

type Shown = { kind: ScanOutcome; person: CheckinPerson } | { kind: "error"; key: string };
type Outcome = Shown & { id: number };

type Source = "camera" | "typed" | "link";

export function CheckinScanner({
  eventId,
  initial = null,
  listHref = null,
}: {
  eventId: number;
  /** A ticket the page was opened with (a phone's camera app followed its QR code). */
  initial?: string | null;
  /** The organisers' list, shown when the counts say the person may open it. */
  listHref?: string | null;
}) {
  const { t, lang } = useTranslation();
  const { timeZone } = useEventZone(eventId);
  // null while rendering on the server and hydrating: no camera button flickers.
  const possible = useSyncExternalStore(noSubscribe, cameraPossible, () => null);
  const [camera, setCamera] = useState<Camera>("idle");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [stats, setStats] = useState<CheckinStats | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<BarcodeReader | null>(null);
  const frameRef = useRef<number | null>(null);
  const fadeRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const pauseUntilRef = useRef(0);
  const lastRef = useRef<{ key: string; at: number } | null>(null);
  const seqRef = useRef(0);
  const initialDone = useRef(false);

  /* ── Counts ─────────────────────────────────────────────────────────── */

  const loadStats = useCallback(async () => {
    try {
      setStats(await checkinApi.stats(eventId));
      setBlocked(null);
    } catch (err) {
      if (!(err instanceof ApiError)) return;
      // The plan has no check-in, or the person is not staff of this event:
      // there is nothing to scan here. Anything else leaves the scanner usable.
      if (err.code === "MODULE_DISABLED") setBlocked("ci.err.MODULE_DISABLED");
      else if (err.status === 403 || err.status === 404) setBlocked("ci.err.FORBIDDEN");
    }
  }, [eventId]);

  useEffect(() => {
    void loadStats();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadStats();
    }, STATS_MS);
    return () => clearInterval(timer);
  }, [loadStats]);

  /* ── One ticket ─────────────────────────────────────────────────────── */

  const show = useCallback((next: Shown) => {
    seqRef.current += 1;
    setOutcome({ ...next, id: seqRef.current });
    if (fadeRef.current) window.clearTimeout(fadeRef.current);
    fadeRef.current = window.setTimeout(() => setOutcome(null), RESULT_MS);
    try {
      navigator.vibrate?.(next.kind === "checked_in" ? 120 : [90, 70, 90]);
    } catch {
      /* no vibration on this device */
    }
  }, []);

  const submit = useCallback(async (raw: string, source: Source) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    const parsed = parseScanInput(text);
    if (source === "camera") {
      const key = parsed.code ?? text;
      const last = lastRef.current;
      if (last && last.key === key && Date.now() - last.at < SAME_TICKET_MS) return;
      lastRef.current = { key, at: Date.now() };
      pauseUntilRef.current = Date.now() + PAUSE_MS;
    }
    // Read here first, as the API reads it: a QR code that is not a ticket,
    // or a ticket for another event, is answered without a request.
    if (parsed.eventId != null && parsed.eventId !== eventId) {
      show({ kind: "error", key: "ci.err.WRONG_EVENT" });
      return;
    }
    if (!parsed.code) {
      show({ kind: "error", key: "ci.err.VALIDATION_ERROR" });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await checkinApi.scan(eventId, text);
      if (!res) throw new Error("unreadable answer");
      show({ kind: res.result, person: res.participant });
      if (source === "typed") setInput("");
      void loadStats();
    } catch (err) {
      // The walkthrough says itself that nothing changes.
      if (err instanceof DemoReadOnlyError) return;
      show({ kind: "error", key: checkinErrorKey(err) });
      if (source === "typed") window.requestAnimationFrame(() => inputRef.current?.select());
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (source === "camera") pauseUntilRef.current = Date.now() + PAUSE_MS;
    }
  }, [eventId, loadStats, show]);

  // The camera loop calls the latest submit without restarting.
  const submitRef = useRef(submit);
  useEffect(() => { submitRef.current = submit; }, [submit]);

  // A ticket the page was opened with is scanned once, then taken off the address.
  useEffect(() => {
    if (!initial || initialDone.current) return;
    initialDone.current = true;
    clearTicketFromUrl();
    void submit(initial, "link");
  }, [initial, submit]);

  /* ── Camera ─────────────────────────────────────────────────────────── */

  const stopCamera = useCallback(() => {
    if (frameRef.current) window.clearTimeout(frameRef.current);
    frameRef.current = null;
    readerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => {
    stopCamera();
    if (fadeRef.current) window.clearTimeout(fadeRef.current);
  }, [stopCamera]);

  const readFrame = useCallback(async () => {
    const reader = readerRef.current;
    const video = videoRef.current;
    if (!reader || !video || !streamRef.current) return;
    try {
      if (!busyRef.current && Date.now() >= pauseUntilRef.current && video.readyState >= 2 && document.visibilityState === "visible") {
        const found = await reader.detect(video);
        const raw = found.find((c) => c.rawValue)?.rawValue;
        if (raw) void submitRef.current(raw, "camera");
      }
    } catch {
      /* a frame that could not be read; the next one is tried */
    }
    if (readerRef.current) frameRef.current = window.setTimeout(() => void readFrame(), FRAME_MS);
  }, []);

  const startCamera = useCallback(async (reloaded = false) => {
    if (isDemoApiEnabled()) {
      window.dispatchEvent(new CustomEvent("hackos:demo-write"));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unsupported");
      return;
    }
    if (!pageAllowsCamera()) {
      // Reached from another page of the app, whose policy this page still
      // has: load it afresh (its own policy allows the camera) and start there.
      if (reloaded) {
        setCamera("denied");
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set(CAMERA_PARAM, "1");
      window.location.assign(url.toString());
      return;
    }
    setCamera("starting");
    let reader: BarcodeReader | null;
    try {
      reader = (await nativeReader()) ?? (await loadJsQrReader());
    } catch {
      setCamera("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("no video element");
      video.srcObject = stream;
      await video.play();
      readerRef.current = reader;
      setCamera("on");
      void readFrame();
    } catch (err) {
      stopCamera();
      const name = err && typeof err === "object" && "name" in err ? String((err as { name?: unknown }).name) : "";
      setCamera(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
    }
  }, [readFrame, stopCamera]);

  // Loaded afresh to start the camera (see startCamera): start it, once.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(CAMERA_PARAM) !== "1") return;
    url.searchParams.delete(CAMERA_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const timer = window.setTimeout(() => void startCamera(true), 0);
    return () => window.clearTimeout(timer);
  }, [startCamera]);

  const turnOff = () => {
    stopCamera();
    setCamera("idle");
  };

  /* ── Screen ─────────────────────────────────────────────────────────── */

  if (blocked) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ci.scan.title")}</h1>
        <Notice tone="warn" icon={<AlertTriangle size={15} />}>{t(blocked)}</Notice>
      </div>
    );
  }

  const pct = stats && stats.admitted > 0 ? Math.round((stats.checkedIn / stats.admitted) * 100) : 0;
  const cameraShown = camera === "on" || camera === "starting";
  const unsupported = possible === false || camera === "unsupported";
  const when = (iso: string | null) => formatInZone(iso, timeZone, lang, { year: undefined });
  const back = listHref && stats?.canManage ? buttonLook("ghost", "sm") : null;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="space-y-2">
        {back && listHref ? (
          <Link href={listHref} className={`-ml-2 ${back.className}`} style={back.style}>
            <ArrowLeft size={14} aria-hidden="true" />
            {t("ci.scan.to_list")}
          </Link>
        ) : null}
        <h1 className="text-[26px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ci.scan.title")}</h1>
        <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>{t("ci.scan.subtitle")}</p>
        {stats ? (
          <div className="pt-1">
            <p className="mb-1.5 text-[14px] font-semibold tabular-nums" style={{ color: "var(--ink)" }} data-scan-counts="">
              {fill(t("ci.scan.counts"), { in: stats.checkedIn, total: stats.admitted })}
            </p>
            <Progress value={pct} tone="ok" />
          </div>
        ) : null}
      </header>

      <div className="space-y-3">
        <div
          className={cameraShown ? "relative overflow-hidden rounded-[var(--radius)] bg-black" : "hidden"}
          style={{ aspectRatio: "4 / 3" }}
        >
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-hidden="true" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[18%] rounded-[18px] border-[3px]"
            style={{ borderColor: "rgba(255,255,255,0.85)", boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)" }}
          />
          {camera === "starting" ? (
            <span className="absolute inset-0 flex items-center justify-center gap-2 text-[14px] font-medium text-white">
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              {t("ci.scan.camera_starting")}
            </span>
          ) : null}
        </div>

        {unsupported ? (
          <Notice tone="info" icon={<CameraOff size={15} />}>{t("ci.scan.camera_unsupported")}</Notice>
        ) : camera === "denied" ? (
          <Notice tone="warn" icon={<CameraOff size={15} />}>{t("ci.scan.camera_denied")}</Notice>
        ) : camera === "failed" ? (
          <Notice tone="warn" icon={<CameraOff size={15} />}>{t("ci.scan.camera_failed")}</Notice>
        ) : null}

        {possible && camera !== "unsupported" ? (
          <div className="flex flex-wrap items-center gap-3">
            {cameraShown ? (
              <>
                <Button size="md" variant="secondary" icon={<CameraOff size={15} />} onClick={turnOff}>{t("ci.scan.camera_stop")}</Button>
                <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("ci.scan.camera_hint")}</span>
              </>
            ) : (
              <Button size="lg" variant="dark" icon={<Camera size={16} />} onClick={() => void startCamera(false)}>{t("ci.scan.camera_start")}</Button>
            )}
          </div>
        ) : null}
      </div>

      <Result outcome={outcome} busy={busy} when={when} />

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input, "typed");
          inputRef.current?.focus();
        }}
      >
        <label htmlFor="ci-code" className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{t("ci.scan.code_label")}</label>
        <div className="flex gap-2">
          <input
            id="ci-code"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("ci.scan.code_placeholder")}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={300}
            aria-describedby="ci-code-hint"
            className="min-h-12 min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 font-mono text-[20px] tracking-[0.08em] outline-none focus:ring-2"
            style={inputStyle()}
          />
          <Button type="submit" size="lg" variant="primary" loading={busy} disabled={busy || !input.trim()} className="shrink-0">
            {t("ci.scan.submit")}
          </Button>
        </div>
        <p id="ci-code-hint" className="text-[12px]" style={{ color: "var(--ink-3)" }}>{t("ci.scan.code_hint")}</p>
      </form>
    </div>
  );
}

/* ── The result, large ─────────────────────────────────────────────────── */

const LOOK = {
  checked_in: { bg: "#15803D", Icon: CheckCircle2 },
  already: { bg: "#B45309", Icon: AlertTriangle },
  not_approved: { bg: "#B91C1C", Icon: XCircle },
  error: { bg: "#B91C1C", Icon: XCircle },
} as const;

function Result({ outcome, busy, when }: { outcome: Outcome | null; busy: boolean; when: (iso: string | null) => string }) {
  const { t } = useTranslation();
  // One live region for every state, so a screen reader hears each result.
  if (!outcome) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[132px] items-center justify-center gap-2.5 rounded-[var(--radius)] border-2 border-dashed px-4 text-[15px] font-medium"
        style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)" }}
        data-scan-result="ready"
      >
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <ScanLine size={18} aria-hidden="true" />}
        {t(busy ? "ci.scan.working" : "ci.scan.ready")}
      </div>
    );
  }
  const look = LOOK[outcome.kind];
  const person = outcome.kind === "error" ? null : outcome.person;
  const status = person ? (["approved", "eliminated", "pending", "waitlisted", "rejected"].includes(person.status) ? t(`ci.status.${person.status}`) : person.status) : "";
  return (
    <div
      key={outcome.id}
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      className="hs-fade min-h-[132px] rounded-[var(--radius)] px-5 py-4 text-white"
      style={{ background: look.bg }}
      data-scan-result={outcome.kind}
    >
      <p className="flex items-center gap-2.5 text-[20px] font-bold leading-tight">
        <look.Icon size={26} aria-hidden="true" className="shrink-0" />
        {t(outcome.kind === "error" ? "ci.scan.result.error" : `ci.scan.result.${outcome.kind}`)}
      </p>
      {person ? (
        <>
          <p className="mt-2 text-[28px] font-bold leading-tight [overflow-wrap:anywhere]">{person.name || "—"}</p>
          <p className="mt-0.5 text-[16px] opacity-90">{person.team || t("ci.no_team")}</p>
        </>
      ) : null}
      {outcome.kind === "already" && person ? (
        <p className="mt-2 text-[15px] font-medium">
          {fill(t("ci.scan.already_detail"), { time: when(person.checkedInAt), by: person.checkedInBy?.name || t("ci.scan.someone") })}
        </p>
      ) : outcome.kind === "not_approved" ? (
        <p className="mt-2 text-[15px] font-medium">{fill(t("ci.scan.not_approved_detail"), { status })}</p>
      ) : outcome.kind === "error" ? (
        <p className="mt-2 text-[16px] font-medium">{t(outcome.key)}</p>
      ) : null}
    </div>
  );
}
