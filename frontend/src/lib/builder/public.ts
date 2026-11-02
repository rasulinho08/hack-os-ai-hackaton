/**
 * The public view of an event — what GET /api/public/events/:slug answers and
 * what the event page draws. The builder's preview maps its own data to the
 * same shape, so the organiser previews exactly the page visitors get.
 */

import type { BuilderPayload, Eligibility, FaqItem, PresentationConfig, SubmissionConfig } from "./types";
import type { TeamFormation } from "./registrationCheck";

export interface PublicField {
  id: number;
  key: string;
  kind: "standard" | "custom";
  type: string;
  label: string | null;
  help: string | null;
  options: string[];
  required: boolean;
  min?: number;
  max?: number;
}

export interface PublicEvent {
  id: number;
  name: string;
  slug: string;
  /** The address asked for, when it is one the event used to have (the page redirects to `slug`). */
  moved_from?: string;
  event_code: string;
  tagline: string | null;
  description: string | null;
  category: string;
  language: "az" | "en" | "ru";
  brand_color: string | null;
  logo_url: string | null;
  banner_url: string | null;
  format: "online" | "offline" | "hybrid";
  /** Who can find it; "invite" takes only invited people. Absent on older answers: public. */
  visibility?: "public" | "private" | "invite";
  venue_name: string | null;
  venue_address: string | null;
  city: string | null;
  country: string | null;
  map_url: string | null;
  timezone: string;
  registration_start: string | null;
  registration_end: string | null;
  team_deadline: string | null;
  start_date: string;
  end_date: string;
  submission_deadline: string | null;
  judging_start: string | null;
  judging_end: string | null;
  demo_day: string | null;
  results_at: string | null;
  registration_mode: "solo" | "team" | "both";
  min_team_size: number;
  team_size_limit: number;
  max_participants: number | null;
  waitlist_enabled: boolean;
  eligibility: Eligibility;
  rules: string | null;
  faq: FaqItem[];
  organiser: { name: string; logo_url: string | null } | null;
  tracks: { id: number; name: string; description: string | null; sponsor_id: number | null }[];
  prizes: { id: number; kind: string; position: number | null; track_id: number | null; name: string; value: string | null; description: string | null }[];
  sponsors: { id: number; name: string; tier: string | null; website: string | null; description: string | null; logo_url: string | null }[];
  criteria: { name: string; description: string | null; weight: number; max_score: number }[];
  submission: SubmissionConfig;
  presentation: PresentationConfig;
  registration: {
    state: "open" | "not_open" | "closed" | "unpublished";
    limit: number | null;
    taken: number;
    approved: number;
    waitlisted: number;
    full: boolean;
    waitlistEnabled: boolean;
    mode: "solo" | "team" | "both";
    approval: "manual" | "team" | "auto";
    /** Whether teams can still be created or joined; absent from older API versions. */
    teamFormation?: TeamFormation;
  };
  form: PublicField[];
}

/** The preview's view of team formation, by the same rule as the API (eventRegistration.teamFormationInfo). */
function teamFormationOf(ev: BuilderPayload["event"], now = Date.now()): TeamFormation {
  const cutoff = ev.team_deadline || ev.start_date || null;
  const disabled = (ev as { allow_team_formation?: boolean }).allow_team_formation === false;
  const open = !disabled && !(cutoff && new Date(cutoff).getTime() <= now);
  const minTeamSize = Number(ev.min_team_size) || 1;
  return { open, closesAt: cutoff, reason: open ? null : disabled ? "disabled" : "deadline", minTeamSize, soloCanCompete: open || disabled || minTeamSize <= 1 };
}

function stateOf(ev: BuilderPayload["event"], now = Date.now()): PublicEvent["registration"]["state"] {
  if (ev.registration_start && new Date(ev.registration_start).getTime() > now) return "not_open";
  if (ev.registration_end && new Date(ev.registration_end).getTime() < now) return "closed";
  if (ev.end_date && new Date(ev.end_date).getTime() < now) return "closed";
  return "open";
}

/** The builder's data as the public page would show it. */
export function fromBuilder(d: BuilderPayload): PublicEvent {
  const e = d.event;
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    event_code: e.event_code,
    tagline: e.tagline,
    description: e.description,
    category: e.category,
    language: e.language,
    brand_color: d.modules.includes("branding") ? e.brand_color : null,
    logo_url: d.modules.includes("branding") ? e.logo_url : null,
    banner_url: d.modules.includes("branding") ? e.banner_url : null,
    format: e.format,
    venue_name: e.venue_name,
    venue_address: e.venue_address,
    city: e.city,
    country: e.country,
    map_url: e.map_url,
    timezone: e.timezone,
    registration_start: e.registration_start,
    registration_end: e.registration_end,
    team_deadline: e.team_deadline,
    start_date: e.start_date,
    end_date: e.end_date,
    submission_deadline: e.submission_deadline,
    judging_start: e.judging_start,
    judging_end: e.judging_end,
    demo_day: e.demo_day,
    results_at: e.results_at,
    registration_mode: e.registration_mode,
    min_team_size: e.min_team_size,
    team_size_limit: e.team_size_limit,
    max_participants: e.max_participants,
    waitlist_enabled: e.waitlist_enabled,
    eligibility: e.eligibility,
    rules: e.rules,
    faq: e.faq,
    organiser: null,
    tracks: d.tracks.map((t) => ({ id: t.id, name: t.name, description: t.description, sponsor_id: t.sponsor_id })),
    prizes: d.prizes.map((p) => ({ id: p.id, kind: p.kind, position: p.position, track_id: p.track_id, name: p.name, value: p.value, description: p.description })),
    sponsors: d.sponsors.map((s) => ({ id: s.id, name: s.name, tier: s.tier, website: s.website, description: s.description, logo_url: s.logo_url })),
    criteria: d.criteria.map((c) => ({ name: c.name, description: c.description, weight: Number(c.weight), max_score: c.max_score })),
    submission: e.submission_config,
    presentation: e.presentation_config,
    registration: {
      state: stateOf(e),
      limit: d.capacity.limit,
      taken: d.capacity.taken,
      approved: d.capacity.approved,
      waitlisted: d.capacity.waitlisted,
      full: d.capacity.full,
      waitlistEnabled: d.capacity.waitlistEnabled,
      mode: e.registration_mode,
      approval: e.approval_mode,
      teamFormation: teamFormationOf(e),
    },
    form: d.fields.filter((f) => f.enabled).map((f) => ({
      id: f.id, key: f.field_key, kind: f.kind, type: f.type, label: f.label, help: f.help, options: f.options, required: f.required,
    })),
  };
}
