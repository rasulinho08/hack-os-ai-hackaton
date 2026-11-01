export interface ApiFieldError {
  field: string;
  message?: string;
  /** The API's reason for this field (REQUIRED, TOO_LONG…), when it sent one. */
  code?: string;
  /** A limit the reason refers to (TOO_LONG's maximum length). */
  max?: number;
  /** The other field the reason refers to (a date out of order: the date it clashes with). */
  other?: string;
}

export class ApiError extends Error {
  status: number;
  /**
   * Field-level validation errors, e.g. from Zod on the backend.
   * Callers can use this to highlight specific inputs instead of
   * just showing the generic message.
   */
  fieldErrors: ApiFieldError[];
  /** The API's machine-readable reason (EMAIL_TAKEN, NOT_READY…), when it sent one. */
  code?: string;
  /** The API's own sentence, without the field details appended to `message`. */
  summary: string;
  constructor(
    message: string,
    status: number,
    fieldErrors: ApiFieldError[] = [],
    code?: string,
    summary?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
    this.summary = summary ?? message;
  }
}

/**
 * Walkthrough mode.
 *
 * The public demo at /demo runs the real organiser screens with no session, so
 * their reads are answered from sample data and their writes are refused here
 * rather than sent to the backend unauthenticated.
 *
 * The reader is installed when the demo layout's module loads, and Next loads
 * that module whenever it prefetches a link to /demo — the site header has
 * one on every page. So it only answers while the address bar is on the
 * walkthrough. Before that check, every marketing page had it armed before
 * anyone clicked anything, and sign-in, sign-up, checkout and the contact
 * form never reached the backend.
 */
type DemoReader = (path: string) => unknown | undefined;
let demoReader: DemoReader | null = null;

function onDemoRoute(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return p === "/demo" || p.startsWith("/demo/");
}

export function enableDemoApi(reader: DemoReader) {
  demoReader = reader;
}

/** Leaving the walkthrough puts the client back on the real backend. */
export function disableDemoApi() {
  demoReader = null;
}

/** Thrown for any write attempted inside the walkthrough. */
export class DemoReadOnlyError extends ApiError {
  constructor() {
    super("This is a walkthrough with sample data — nothing here can be changed.", 403);
    this.name = "DemoReadOnlyError";
  }
}

export function isDemoApiEnabled() {
  return demoReader != null && onDemoRoute();
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();

  if (demoReader && onDemoRoute()) {
    if (method !== "GET" && method !== "HEAD") {
      /*
       * Announce the refusal as well as throwing it. Each screen catches a
       * failed write and shows its own wording — "something went wrong" — which
       * in a walkthrough reads as a broken product rather than a deliberate
       * read-only mode. The walkthrough layout listens for this and says what
       * actually happened.
       */
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("hackos:demo-write"));
      }
      throw new DemoReadOnlyError();
    }
    const answer = demoReader(path);
    // An unrecognised read is a gap in the demo router, not a reason to call
    // a backend the visitor has no session for.
    if (answer === undefined) throw new ApiError(`Not in the walkthrough: ${path}`, 404);
    return answer as T;
  }

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  // Only set Content-Type for requests that carry a body
  if (method !== "GET" && method !== "HEAD" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  // Problem 15: mobile browsers / carrier proxies can keep stale GET
  // responses longer than desktop. Force every API read to bypass caches
  // so users immediately see fresh dashboard/lobby data.
  if (method === "GET" || method === "HEAD") {
    if (!headers["Cache-Control"]) {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
    }
    if (!headers.Pragma) {
      headers.Pragma = "no-cache";
    }
  }

  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers,
    ...(method === "GET" || method === "HEAD"
      ? { cache: "no-store" as const }
      : {}),
  });

  if (res.status === 204) return undefined as T;

  // Guard: ensure the response is JSON before parsing
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new ApiError(
      text.slice(0, 200) || `Server error (${res.status})`,
      res.status,
    );
  }

  const data = await res.json();

  if (!data.success) {
    const baseMsg = data.message || "Something went wrong";
    // Collect structured field errors so callers can highlight inputs
    // (problem 9 in the screenshot — the user sees "Validation failed"
    // and has no idea which field was the problem).
    const fieldErrors: ApiFieldError[] = [];
    let detail = "";
    const errs = (data as { errors?: unknown }).errors;
    if (Array.isArray(errs) && errs.length > 0) {
      detail = errs
        .map((e) => {
          if (typeof e === "string") {
            fieldErrors.push({ field: "(root)", message: e });
            return e;
          }
          if (e && typeof e === "object") {
            const o = e as {
              field?: string;
              path?: string | (string | number)[];
              message?: string;
              msg?: string;
              code?: string;
              max?: number;
              other?: string;
            };
            const pathStr = Array.isArray(o.path)
              ? o.path.join(".")
              : o.path != null && o.path !== ""
                ? String(o.path)
                : "";
            const field =
              o.field != null && String(o.field) !== "" ? String(o.field) : pathStr;
            const msg = o.message || o.msg;
            if (field) {
              fieldErrors.push({
                field,
                message: msg,
                ...(typeof o.code === "string" ? { code: o.code } : {}),
                ...(typeof o.max === "number" ? { max: o.max } : {}),
                ...(typeof o.other === "string" ? { other: o.other } : {}),
              });
            }
            return field && msg ? `${field}: ${msg}` : msg || (field && o.code ? `${field}: ${o.code}` : JSON.stringify(e));
          }
          return String(e);
        })
        .join("; ");
    } else if (errs && typeof errs === "object") {
      const entries = Object.entries(errs as Record<string, unknown>);
      for (const [k, v] of entries) {
        const message = Array.isArray(v) ? v.join(", ") : String(v);
        fieldErrors.push({ field: k, message });
      }
      detail = entries
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
        .join("; ");
    }
    const messageHasInlineValidation =
      typeof baseMsg === "string" &&
      (baseMsg.includes("Validation failed —") ||
        baseMsg.includes("Validation failed:"));
    const code = typeof (data as { code?: unknown }).code === "string" ? (data as { code: string }).code : undefined;
    throw new ApiError(
      messageHasInlineValidation
        ? baseMsg
        : detail
          ? `${baseMsg}: ${detail}`
          : baseMsg,
      res.status,
      fieldErrors,
      code,
      baseMsg,
    );
  }

  const payload = data.data as unknown;

  /**
   * Backend login wraps the account row under `data.user` (plus `token`).
   * Callers type the response as the user object; returning the envelope
   * leaves `role` / `email` undefined and breaks login + join flows.
   */
  if (method === "POST") {
    const p = path.split("?")[0]?.replace(/\/+$/, "") ?? "";
    if (
      p === "/api/auth/login" &&
      payload !== null &&
      typeof payload === "object" &&
      "user" in (payload as object)
    ) {
      const inner = (payload as { user?: unknown }).user;
      if (inner !== null && typeof inner === "object") {
        return inner as T;
      }
    }
  }

  return payload as T;
}

/*
 * Reads that are already on the wire are shared rather than repeated.
 *
 * The organiser dashboard is assembled from independent components that each
 * fetch what they need, so a single page load asked for
 * /api/events/42/participants three times, /api/teams three times and
 * /api/announcements three times — the same responses, fetched in parallel,
 * three times the database work for one screen.
 *
 * Only requests that overlap in time are shared: the entry is dropped the
 * moment the response settles, so this is a de-duplicator and not a cache.
 * A refetch after a create or a delete still goes to the network, which is
 * why there is no TTL here — stale reads after a write would be a far worse
 * bug than the duplicate ones this removes.
 */
const inFlightReads = new Map<string, Promise<unknown>>();

export function apiGet<T = unknown>(path: string) {
  const existing = inFlightReads.get(path);
  if (existing) return existing as Promise<T>;

  const request = api<T>(path).finally(() => {
    inFlightReads.delete(path);
  });
  inFlightReads.set(path, request);
  return request;
}

/** Test seam: forget any read currently being shared. */
export function __resetInFlightReads() {
  inFlightReads.clear();
}

export function apiPost<T = unknown>(path: string, body: unknown) {
  return api<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function apiPut<T = unknown>(path: string, body: unknown) {
  return api<T>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function apiPatch<T = unknown>(path: string, body: unknown) {
  return api<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function apiDelete<T = unknown>(path: string, body?: unknown) {
  return api<T>(path, {
    method: "DELETE",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
