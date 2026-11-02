/**
 * Shapes the event builder API answers with (GET /api/events/:id/builder and
 * friends). Column names stay snake_case, as the API sends them.
 */

export type SectionKey =
  | "basics" | "brand" | "place" | "schedule" | "registration" | "eligibility" | "form"
  | "tracks" | "prizes" | "sponsors" | "judging" | "judges" | "mentors" | "volunteers"
  | "submissions" | "presentation" | "communication" | "resources" | "certificates" | "share";

export type Severity = "error" | "warning";

export interface ChecklistItem {
  severity: Severity;
  section: SectionKey;
  code: string;
  params?: Record<string, string | number>;
}

export type SubmissionFieldState = "required" | "optional" | "off";

export interface Eligibility {
  minAge: number | null;
  maxAge: number | null;
  countries: string[];
  cities: string[];
  studentsOnly: boolean;
  requireRules: boolean;
  requireCoc: boolean;
}

export interface SubmissionConfig {
  fields: Record<"repo" | "demo" | "slides" | "video" | "summary" | "tech", SubmissionFieldState>;
  files: { enabled: boolean; maxMb: number; types: string[] };
  /** Check GitHub repositories for work from before the start (J1). */
  githubCheck?: boolean;
}

export interface JudgingConfig {
  blind: boolean;
  assignment: "all" | "track" | "per_team";
  judgesPerTeam: number;
  resultsVisibility: "full" | "own_and_winners" | "winners";
  /** Judges confirm a conflict-of-interest declaration before they score. */
  coiRequired?: boolean;
  /** Participants see their scores and the judges' written feedback with their place. */
  showScores?: boolean;
  /** Participants vote for one project of another team (people's choice). */
  peopleChoice?: boolean;
  /** When people's choice opens (ISO); null: when submissions close. */
  votingStart?: string | null;
}

export interface MentorConfig {
  ticketsEnabled: boolean;
  maxOpenTicketsPerTeam: number;
  showOnlineStatus: boolean;
}

export interface PresentationConfig {
  order: "submission" | "random" | "manual";
  slotMinutes: number;
  qaMinutes: number;
  warnSeconds: number;
}

/** Which event chat channels exist (plan module "chat"). */
export interface ChatSwitches {
  general: boolean;
  team: boolean;
  support: boolean;
}

export interface CommsConfig {
  senderName: string;
  replyTo: string;
  auto: Record<string, boolean>;
  /** Missing on events saved before the chat existed: everything on. */
  chat?: ChatSwitches;
}

export interface CertificateConfig {
  types: string[];
  signerName: string;
  signerTitle: string;
  signatureFileId: string | null;
  issueAfterResults: boolean;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface BuilderEvent {
  id: number;
  event_code: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  category: string;
  language: "az" | "en" | "ru";
  status: string;
  derived_status?: string;
  is_published: boolean;
  published_at: string | null;
  /** Where the event is now (the API's phase rule; see lib/eventPhase). */
  phase?: string;
  /** Who can find the event: anyone, people with the link, or invited people only. */
  visibility?: "public" | "private" | "invite";
  /** "Show in the HackOS directory" (only a public event is ever listed). */
  directory_listed?: boolean;
  template: string | null;
  customer_id: number | null;
  entitlement_id: number | null;
  brand_color: string | null;
  logo_file_id: string | null;
  banner_file_id: string | null;
  logo_url: string | null;
  banner_url: string | null;
  format: "online" | "offline" | "hybrid";
  venue_name: string | null;
  venue_address: string | null;
  city: string | null;
  country: string | null;
  map_url: string | null;
  online_url: string | null;
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
  approval_mode: "manual" | "team" | "auto";
  allow_late_submissions: boolean;
  require_submission: boolean;
  eligibility: Eligibility;
  rules: string | null;
  faq: FaqItem[];
  submission_config: SubmissionConfig;
  judging_config: JudgingConfig;
  mentor_config: MentorConfig;
  presentation_config: PresentationConfig;
  comms_config: CommsConfig;
  certificate_config: CertificateConfig;
  builder_state: { visited?: SectionKey[]; last?: SectionKey | null };
}

export interface FormField {
  id: number;
  field_key: string;
  kind: "standard" | "custom";
  type: string;
  label: string | null;
  help: string | null;
  options: string[];
  required: boolean;
  enabled: boolean;
  sensitive: boolean;
  sort_order: number;
  answer_count?: number;
}

export interface Track {
  id: number;
  name: string;
  description: string | null;
  sponsor_id: number | null;
  sort_order: number;
}

export interface Prize {
  id: number;
  kind: "place" | "special" | "track";
  position: number | null;
  track_id: number | null;
  name: string;
  value: string | null;
  description: string | null;
  sort_order: number;
}

export interface Sponsor {
  id: number;
  name: string;
  tier: string | null;
  website: string | null;
  description: string | null;
  logo_file_id: string | null;
  logo_url: string | null;
  sort_order: number;
}

export interface Criterion {
  id: number;
  name: string;
  description: string | null;
  max_score: number;
  weight: number | string;
  sort_order: number;
  score_count?: number;
}

export interface StaffMember {
  id: number;
  user_id: number;
  full_name: string;
  email: string;
  expertise?: string | null;
  availability?: string | null;
  assigned_tasks?: string | null;
}

export interface PendingInvite {
  id: number;
  email: string;
  role: "judge" | "mentor" | "volunteer";
  meta: { tracks?: number[]; expertise?: string; tasks?: string };
  created_at: string;
  /** An account with this address exists but has not confirmed it: the role opens once it does. */
  awaiting_verification?: boolean;
}

export interface Resource {
  id: number;
  section: string;
  label: string;
  description: string | null;
  url: string | null;
  sort_order: number;
  visible_from: string | null;
}

export interface Capacity {
  limit: number | null;
  taken: number;
  approved: number;
  waitlisted: number;
  full: boolean;
  waitlistEnabled: boolean;
}

export interface BuilderPayload {
  event: BuilderEvent;
  fields: FormField[];
  tracks: Track[];
  prizes: Prize[];
  sponsors: Sponsor[];
  criteria: Criterion[];
  staff: { judges: StaffMember[]; mentors: StaffMember[]; volunteers: StaffMember[]; invites: PendingInvite[] };
  resources: Resource[];
  plan: string | null;
  modules: string[];
  limits: { participants: number | null; storageGb: number | null };
  checklist: ChecklistItem[];
  ready: boolean;
  capacity: Capacity;
  refs: { source: string; registrations: number }[];
}

export interface StandardFieldDef {
  key: string;
  type: string;
  options: string[];
  defaultOn: boolean;
  sensitive: boolean;
  min?: number;
  max?: number;
}

export interface Catalog {
  templates: string[];
  sections: { key: SectionKey; module?: string }[];
  categories: string[];
  languages: string[];
  formats: string[];
  registrationModes: string[];
  approvalModes: string[];
  standardFields: StandardFieldDef[];
  customFieldTypes: string[];
  submissionFields: string[];
  submissionFileTypes: string[];
  autoAnnouncements: string[];
  certificateTypes: string[];
  resultsVisibility: string[];
  judgeAssignment: string[];
  presentationOrder: string[];
  sponsorTiers: string[];
  prizeKinds: string[];
}

export type ListKind = "tracks" | "prizes" | "sponsors" | "criteria" | "form";

export interface SyncResult<T> {
  items: T[];
  idsByCid: Record<string, number>;
  checklist: ChecklistItem[];
  ready: boolean;
}

export interface UploadedFile {
  id: string;
  purpose: string;
  filename: string;
  mime: string;
  size: number;
  url: string;
  claimToken?: string;
}
