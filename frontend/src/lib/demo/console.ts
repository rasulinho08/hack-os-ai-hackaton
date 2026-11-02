/**
 * Sample data for the public console walkthrough at /demo.
 *
 * The walkthrough runs the real organiser screens — the same components the
 * product ships — against this module instead of the backend, so a visitor
 * sees the actual console rather than a mock-up of it, and the demo cannot
 * drift away from the product without the product noticing.
 *
 * Everything here is invented. No participant of a real event appears in it:
 * publishing a page anyone can open means real names and e-mail addresses
 * must not be on it, so the names below are generated and every address
 * points at a domain we control.
 *
 * Shapes match what the API actually returns — snake_case, the same optional
 * fields the screens normalise around — because the point is to exercise the
 * real normalisers, not to hand the screens something pre-digested.
 */

export const DEMO_EVENT_ID = 1;

/* ─── Deterministic pseudo-random ──────────────────────────────────────
 * Seeded so the demo is identical on the server and the client, and from one
 * visit to the next. Someone who sends a colleague a screenshot and a link
 * must have them land on the same numbers.
 */
function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
const pick = <T,>(arr: readonly T[], seed: number) =>
  arr[Math.floor(rand(seed) * arr.length) % arr.length];

const FIRST = [
  "Aysel", "Rəşad", "Nigar", "Elvin", "Günel", "Murad", "Leyla", "Kamran",
  "Səbinə", "Orxan", "Nərmin", "Tural", "Aygün", "Elçin", "Fidan", "Ramin",
  "Zeynəb", "Cavid", "Lalə", "Emin", "Ülviyyə", "Nihad", "Şəbnəm", "Fərid",
  "Mələk", "Anar", "Türkan", "Vüsal", "Aytac", "Rüfət", "Gülnar", "Samir",
] as const;

const LAST = [
  "Məmmədova", "Əliyev", "Hüseynova", "Quliyev", "Rzayeva", "Səfərov",
  "İsmayılova", "Kərimov", "Abbasova", "Nəbiyev", "Həsənova", "Vəliyev",
  "Cəfərova", "Bağırov", "Sultanova", "Mustafayev",
] as const;

const UNIS = [
  "ADA University", "Baku Higher Oil School", "ASOIU", "Khazar University",
  "Baku State University", "UNEC", "Azerbaijan Technical University",
] as const;

const SKILLS = [
  ["React", "TypeScript", "Node.js"], ["Python", "FastAPI", "PostgreSQL"],
  ["Figma", "UI/UX", "Prototyping"], ["Flutter", "Dart", "Firebase"],
  ["Go", "Docker", "Kubernetes"], ["ML", "PyTorch", "Pandas"],
  ["Vue", "Nuxt", "Tailwind"], ["Java", "Spring", "MySQL"],
] as const;

const EXPERIENCE = ["beginner", "intermediate", "advanced", "expert"] as const;
const ROLES = ["Frontend", "Backend", "Designer", "Data", "Mobile", "Full-stack"] as const;

const TEAM_NAMES = [
  "Neurons", "CodeShift", "Bakı Bytes", "DataDivers", "Loop", "Terminal Velocity",
  "GreenStack", "Orbit", "Signal", "Kaspi Coders", "Mangrove", "Pixel Guild",
  "Quanta", "Redshift", "SolidState", "Tabriz", "Uplink", "Vertex",
  "Waveform", "Xəzər AI", "Yarasa", "Zenith", "Anchor", "Beacon",
] as const;

const PROJECTS = [
  "Queue-free clinic check-in", "Bus arrival predictions for Baku",
  "Offline-first exam practice", "Waste-sorting camera",
  "Small-farm irrigation planner", "Sign-language captions",
  "Rent contract checker", "Flood risk map for the Kur",
  "Textbook resale market", "Energy bill explainer",
  "Volunteer shift matcher", "Regional dialect speech corpus",
  "Rapid triage for pharmacies", "Carpool for shift workers",
  "Accessible menu reader", "Local produce price index",
  "Course credit transfer helper", "Noise complaint router",
  "Beekeeping hive monitor", "Street-light fault reporter",
  "Library seat finder", "Freelance invoice generator",
  "Earthquake drill trainer", "Pothole severity ranker",
] as const;

const TEAM_COUNT = TEAM_NAMES.length;
const PARTICIPANT_COUNT = 118;

/* ─── Event ─────────────────────────────────────────────────────────── */

export const DEMO_EVENT = {
  id: DEMO_EVENT_ID,
  name: "Demo Hackathon 2026",
  event_code: "DEMO26",
  description:
    "A sample 48-hour hackathon used to show the organiser console. Every name, team and score here is invented.",
  start_date: "2026-08-28T09:00:00.000Z",
  end_date: "2026-08-30T18:00:00.000Z",
  location: "Baku, Azerbaijan",
  status: "active",
  derived_status: "judging",
  max_participants: 150,
  max_team_size: 5,
  organizer: "HackOS",
};

/* ─── Participants ──────────────────────────────────────────────────── */

export interface DemoParticipant {
  id: number;
  user_id: number;
  full_name: string;
  email: string;
  status: string;
  team: string;
  /** The same as the API's list: the team in this event and who leads it. */
  team_name: string | null;
  current_team_id: number | null;
  team_leader: boolean | null;
  looking_for_team: boolean;
  role: string;
  is_team_lead: boolean;
  is_solo: boolean;
  skills: string[];
  experience: string;
  university: string;
  registered_at: string;
}

export const DEMO_PARTICIPANTS: DemoParticipant[] = Array.from(
  { length: PARTICIPANT_COUNT },
  (_, i) => {
    const n = i + 1;
    const first = pick(FIRST, n * 3.1);
    const last = pick(LAST, n * 7.7);
    const teamIndex = i % TEAM_COUNT;
    const isLead = i < TEAM_COUNT;
    // A handful never found a team — the console has a filter for exactly this.
    const solo = n % 23 === 0;
    const status =
      n % 19 === 0 ? "pending" : n % 37 === 0 ? "rejected" : "approved";
    return {
      id: 1000 + n,
      user_id: 1000 + n,
      full_name: `${first} ${last}`,
      email: `${first.toLowerCase().replace(/[^a-z]/g, "")}.${n}@demo.hack-os.app`,
      status,
      team: solo ? "" : TEAM_NAMES[teamIndex],
      team_name: solo ? null : TEAM_NAMES[teamIndex],
      current_team_id: solo ? null : 200 + teamIndex + 1,
      team_leader: solo ? null : isLead,
      looking_for_team: solo && status === "approved",
      role: pick(ROLES, n * 2.3),
      is_team_lead: isLead,
      is_solo: solo,
      skills: [...pick(SKILLS, n * 5.9)],
      experience: pick(EXPERIENCE, n * 1.7),
      university: pick(UNIS, n * 4.3),
      registered_at: new Date(
        Date.UTC(2026, 7, 4 + (n % 18), 8 + (n % 11), (n * 7) % 60),
      ).toISOString(),
    };
  },
);

/* ─── Teams ─────────────────────────────────────────────────────────── */

export const DEMO_TEAMS = TEAM_NAMES.map((name, idx) => {
  const members = DEMO_PARTICIPANTS.filter((p) => p.team === name).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    name: p.full_name,
    email: p.email,
    is_lead: p.is_team_lead,
  }));
  const lead = members.find((m) => m.is_lead) ?? members[0];
  return {
    id: 200 + idx + 1,
    event_id: DEMO_EVENT_ID,
    name,
    team_name: name,
    // Both are on the real row: the console prefers `leader_id` and shows the
    // join code in its own column, so leaving them out made every team look
    // leaderless with a blank code.
    leader_id: lead ? lead.id : null,
    join_code: `${name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4)}${200 + idx + 1}`,
    members,
    member_count: members.length,
    memberNames: members.map((m) => m.full_name),
    status: idx % 11 === 10 ? "eliminated" : "active",
    created_at: new Date(
      Date.UTC(2026, 7, 12 + (idx % 6), 10, idx * 2),
    ).toISOString(),
  };
});

/* ─── Submissions ───────────────────────────────────────────────────── */

export const DEMO_SUBMISSIONS = DEMO_TEAMS.map((team, idx) => ({
  id: 300 + idx + 1,
  event_id: DEMO_EVENT_ID,
  team_id: team.id,
  team_name: team.name,
  project_name: PROJECTS[idx % PROJECTS.length],
  description:
    "Built during the 48 hours. Repository, deployed demo and slides submitted before the deadline.",
  repo_link: `https://github.com/demo-hackos/${TEAM_NAMES[idx]
    .toLowerCase()
    .replace(/[^a-z]+/g, "-")}`,
  demo_link: `https://demo.hack-os.app/projects/${idx + 1}`,
  presentation_link: `https://demo.hack-os.app/slides/${idx + 1}`,
  status: idx % 13 === 12 ? "in_review" : "submitted",
  // The submissions screen prints `submitted_at`; without it every card showed
  // a dash where the hand-in time belongs.
  submitted_at: new Date(Date.UTC(2026, 7, 30, 14, (idx * 11) % 60)).toISOString(),
  created_at: new Date(Date.UTC(2026, 7, 30, 14, (idx * 11) % 60)).toISOString(),
  updated_at: new Date(Date.UTC(2026, 7, 30, 16, (idx * 7) % 60)).toISOString(),
}));

/* ─── Judging ───────────────────────────────────────────────────────── */

export const DEMO_CRITERIA = [
  { id: 1, event_id: DEMO_EVENT_ID, name: "Problem fit", max_score: 10, weight: 1, sort_order: 1 },
  { id: 2, event_id: DEMO_EVENT_ID, name: "Technical execution", max_score: 10, weight: 1, sort_order: 2 },
  { id: 3, event_id: DEMO_EVENT_ID, name: "Design and usability", max_score: 10, weight: 1, sort_order: 3 },
  { id: 4, event_id: DEMO_EVENT_ID, name: "Presentation", max_score: 10, weight: 1, sort_order: 4 },
];

const JUDGE_NAMES = [
  "Kənan Əliyev", "Sevinc Rəhimova", "Toğrul Məmmədov",
  "Ayan Quliyeva", "Rəşad Nəsirov",
] as const;

export const DEMO_JUDGES = JUDGE_NAMES.map((full_name, i) => ({
  id: 400 + i + 1,
  event_id: DEMO_EVENT_ID,
  user_id: 5000 + i + 1,
  full_name,
  email: `judge${i + 1}@demo.hack-os.app`,
  created_at: "2026-08-20T09:00:00.000Z",
}));

/*
 * Scores are deliberately incomplete: the fifth judge is behind and two
 * submissions are still untouched. Coverage gaps are what organisers actually
 * watch during judging, so the demo shows them rather than a tidy full grid.
 */
export const DEMO_SCORES = (() => {
  const rows: Array<{
    id: number;
    event_id: number;
    judge_id: number;
    submission_id: number;
    criterion_id: number;
    score: number;
    created_at: string;
  }> = [];
  let id = 1;
  DEMO_SUBMISSIONS.forEach((sub, si) => {
    if (si >= DEMO_SUBMISSIONS.length - 2) return;
    DEMO_JUDGES.forEach((judge, ji) => {
      if (ji === DEMO_JUDGES.length - 1 && si % 3 !== 0) return;
      DEMO_CRITERIA.forEach((crit) => {
        const base = 5 + rand(si * 31 + ji * 7 + crit.id * 3) * 4.6;
        rows.push({
          id: id++,
          event_id: DEMO_EVENT_ID,
          judge_id: judge.id,
          submission_id: sub.id,
          criterion_id: crit.id,
          score: Math.round(base * 10) / 10,
          created_at: "2026-08-31T12:00:00.000Z",
        });
      });
    });
  });
  return rows;
})();

/* ─── Mentors, volunteers, invites ──────────────────────────────────── */

export const DEMO_MENTORS = [
  { full_name: "Nərmin Əsgərova", expertise: "Frontend, React", availability: "Saturday 10:00–18:00" },
  { full_name: "Elvin Şirinov", expertise: "Backend, PostgreSQL", availability: "Both days" },
  { full_name: "Günay Hacıyeva", expertise: "Product, UX research", availability: "Sunday only" },
  { full_name: "Ramil Əhmədov", expertise: "DevOps, Docker", availability: "Both days" },
  { full_name: "Şəhla Vəliyeva", expertise: "Machine learning", availability: "Saturday evening" },
  { full_name: "Ceyhun Babayev", expertise: "Mobile, Flutter", availability: "Both days" },
].map((m, i) => ({
  id: 600 + i + 1,
  event_id: DEMO_EVENT_ID,
  user_id: 6000 + i + 1,
  email: `mentor${i + 1}@demo.hack-os.app`,
  created_at: "2026-08-18T09:00:00.000Z",
  // The shape the mentors API sends: skills as a list, where to find them,
  // what they say about themselves, what they are on.
  skills: m.expertise.split(/,\s*/),
  location: `Mentor desk ${i + 1}`,
  presence: i === 4 ? "away" : i === 1 ? "busy" : "available",
  online: i < 4,
  active_tickets: i === 1 ? 2 : i % 3 === 0 ? 1 : 0,
  resolved_tickets: 3 + ((i * 2) % 5),
  waiting_for_them: i === 0 ? 1 : 0,
  next_slot: null,
  ...m,
}));

export const DEMO_VOLUNTEERS = [
  { full_name: "Aysu Kərimli", assigned_tasks: "Registration desk, Saturday morning" },
  { full_name: "Nicat Səlimov", assigned_tasks: "Floor support and snacks" },
  { full_name: "Zərifə Nəbiyeva", assigned_tasks: "Judging room logistics" },
  { full_name: "Elmar Qasımov", assigned_tasks: "Streaming and photos" },
  { full_name: "Aytən Rüstəmli", assigned_tasks: "Wayfinding, help desk" },
].map((v, i) => ({
  id: 700 + i + 1,
  event_id: DEMO_EVENT_ID,
  user_id: 7000 + i + 1,
  email: `volunteer${i + 1}@demo.hack-os.app`,
  created_at: "2026-08-19T09:00:00.000Z",
  ...v,
}));

export const DEMO_INVITES = [
  { email: "judge6@demo.hack-os.app", role: "judge" as const, used_at: null },
  { email: "mentor7@demo.hack-os.app", role: "mentor" as const, used_at: null },
  { email: "volunteer6@demo.hack-os.app", role: "volunteer" as const, used_at: null },
].map((r, i) => ({
  id: 800 + i + 1,
  event_id: DEMO_EVENT_ID,
  user_id: null,
  created_at: "2026-08-22T09:00:00.000Z",
  ...r,
}));

/* ─── Volunteer tasks ───────────────────────────────────────────────── */

export const DEMO_VOLUNTEER_TASKS = [
  { title: "Registration desk", location: "Entrance hall", status: "done", who: 0 },
  { title: "Badges for late arrivals", location: "Entrance hall", status: "doing", who: 0 },
  { title: "Pizza pickup at 13:00", location: "Back door", status: "todo", who: 1 },
  { title: "Judging room: water and HDMI", location: "Room 204", status: "todo", who: 2 },
  { title: "Photos of the opening", location: "Main hall", status: "done", who: 3 },
  { title: "Extension cords to tables 9–12", location: "Main hall", status: "todo", who: null },
].map((x, i) => ({
  id: 1100 + i + 1,
  event_id: DEMO_EVENT_ID,
  title: x.title,
  details: null,
  location: x.location,
  due_at: new Date(Date.UTC(2026, 7, 29, 9 + i, 0)).toISOString(),
  assignee_id: x.who == null ? null : DEMO_VOLUNTEERS[x.who].user_id,
  assignee_name: x.who == null ? null : DEMO_VOLUNTEERS[x.who].full_name,
  status: x.status,
  done_at: x.status === "done" ? new Date(Date.UTC(2026, 7, 29, 10 + i, 0)).toISOString() : null,
  created_at: "2026-08-28T09:00:00.000Z",
}));

/* ─── Help queue ────────────────────────────────────────────────────── */

const TICKET_ISSUES = [
  "Deployment fails on the free tier",
  "Cannot connect to the provided Postgres instance",
  "OAuth redirect loops on localhost",
  "Need help splitting the repo into two services",
  "Map tiles not loading in the demo build",
  "Which dataset licence applies to the traffic data?",
  "Flutter build stuck on Gradle",
  "Judge cannot see our submission",
  "How do we hand over the presentation file?",
  "WebSocket disconnects every 30 seconds",
  "Team member registered with the wrong e-mail",
  "Docker image too large for the deploy limit",
  "CORS blocked between our front and back end",
  "Need a second power strip at table 9",
] as const;

export const DEMO_TICKETS = TICKET_ISSUES.map((issue, i) => {
  const status = i < 3 ? "open" : i < 5 ? "claimed" : "resolved";
  return {
    id: 900 + i + 1,
    event_id: DEMO_EVENT_ID,
    team_name: TEAM_NAMES[i % TEAM_COUNT],
    team_id: DEMO_TEAMS[i % TEAM_COUNT].id,
    issue,
    description: issue,
    table: `Table ${(i % 12) + 1}`,
    topic: issue,
    table_location: `Table ${(i % 12) + 1}`,
    status: status === "claimed" ? "in-progress" : status,
    closed_reason: status === "resolved" ? "resolved" : null,
    claimed_at: status === "open" ? null : new Date(Date.UTC(2026, 7, 29, 10 + (i % 10), ((i * 13) % 60) + 4)).toISOString(),
    mentor_name:
      status === "open" ? null : DEMO_MENTORS[i % DEMO_MENTORS.length].full_name,
    priority: i % 7 === 0 ? "high" : "normal",
    created_at: new Date(
      Date.UTC(2026, 7, 29, 10 + (i % 10), (i * 13) % 60),
    ).toISOString(),
    updated_at: new Date(
      Date.UTC(2026, 7, 29, 12 + (i % 8), (i * 5) % 60),
    ).toISOString(),
  };
});

/* ─── Announcements ─────────────────────────────────────────────────── */

export const DEMO_ANNOUNCEMENTS = [
  { title: "Judging starts at 10:00", body: "Presentations run in the order published under Presentations. Be at the main hall ten minutes early.", priority: "high" },
  { title: "Submission deadline moved to 18:30", body: "Thirty extra minutes because of the network outage this afternoon. The form closes automatically.", priority: "high" },
  { title: "Dinner is served on the second floor", body: "Vegetarian and halal options are labelled. Please bring your badge.", priority: "normal" },
  { title: "Mentor office hours until midnight", body: "Six mentors are on the help queue tonight. Open a ticket rather than waiting at a desk.", priority: "normal" },
  { title: "Cloud credits are in Resources", body: "Each team gets one voucher. Redeem it with the team lead account only.", priority: "normal" },
  { title: "Welcome — registration is open", body: "Check in at the front desk, find your table number, and join the team channel.", priority: "low" },
].map((a, i) => {
  const at = new Date(Date.UTC(2026, 7, 30 - i, 9, (i * 17) % 60)).toISOString();
  return {
    id: 1100 + i + 1,
    event_id: DEMO_EVENT_ID,
    created_at: at,
    sent_at: at,
    author: "Demo Organiser",
    author_name: "Demo Organiser",
    content: a.body,
    // The walkthrough has no Telegram or mail connected, so everything went out in the app only.
    status: "sent",
    audience: "everyone",
    channels: ["platform"],
    source: "app",
    deliveries: {},
    ...a,
  };
});

/* ─── Resources ─────────────────────────────────────────────────────── */

export const DEMO_RESOURCES = [
  { section: "API Keys", label: "Maps API voucher", description: "One key per team, 50k requests.", url: "https://demo.hack-os.app/resources/maps" },
  { section: "Cloud Credits", label: "Compute credits", description: "$100 per team, expires 30 days after the event.", url: "https://demo.hack-os.app/resources/cloud" },
  { section: "Datasets", label: "Baku transport open data", description: "Stops, routes and 12 months of timings.", url: "https://demo.hack-os.app/resources/transport" },
  { section: "Datasets", label: "Air quality readings", description: "Hourly readings from 14 stations.", url: "https://demo.hack-os.app/resources/air" },
  { section: "Documentation", label: "Submission checklist", description: "What every project must include by the deadline.", url: "https://demo.hack-os.app/resources/checklist" },
  { section: "Documentation", label: "Judging rubric", description: "The four criteria and how they are weighted.", url: "https://demo.hack-os.app/resources/rubric" },
  { section: "Design", label: "Brand kit", description: "Logos and the slide template for the final pitch.", url: "https://demo.hack-os.app/resources/brand" },
  { section: "Support", label: "Wi-Fi and venue map", description: "Network details and floor plan.", url: "https://demo.hack-os.app/resources/venue" },
].map((r, i) => ({
  id: 1200 + i + 1,
  event_id: DEMO_EVENT_ID,
  sort_order: i + 1,
  ...r,
}));

/* ─── Presentations ─────────────────────────────────────────────────── */

export const DEMO_PRESENTATIONS = DEMO_TEAMS.map((team, i) => ({
  id: 1300 + i + 1,
  event_id: DEMO_EVENT_ID,
  team_id: team.id,
  team_name: team.name,
  project_name: PROJECTS[i % PROJECTS.length],
  slot_order: i + 1,
  sort_order: i + 1,
  scheduled_at: new Date(Date.UTC(2026, 7, 31, 10, i * 8)).toISOString(),
  duration_minutes: 6,
  room: i % 2 === 0 ? "Main hall" : "Room B",
  status: i < 9 ? "done" : "scheduled",
  link: `https://demo.hack-os.app/slides/${i + 1}`,
}));

/* ─── Feedback ──────────────────────────────────────────────────────── */

const FEEDBACK_COMMENTS = [
  "Mentors were genuinely useful — the queue meant we never waited long.",
  "Would have liked more power sockets near table 12.",
  "Judging felt fair. Getting the per-criterion scores back was the best part.",
  "The venue was cold on Saturday night.",
  "Good balance between workshops and build time.",
  "Submission form was clear, no surprises at the deadline.",
  "More vegetarian options next time please.",
  "Loved that the schedule was visible from the participant view.",
] as const;

export const DEMO_FEEDBACK = Array.from({ length: 42 }, (_, i) => ({
  id: 1400 + i + 1,
  event_id: DEMO_EVENT_ID,
  rating: 3 + Math.round(rand(i * 9.1) * 2),
  comment: FEEDBACK_COMMENTS[i % FEEDBACK_COMMENTS.length],
  author: DEMO_PARTICIPANTS[i % DEMO_PARTICIPANTS.length].full_name,
  created_at: new Date(
    Date.UTC(2026, 7, 31, 12 + (i % 9), (i * 13) % 60),
  ).toISOString(),
}));

/* ─── Settings ──────────────────────────────────────────────────────── */

export const DEMO_SETTINGS = {
  event_id: DEMO_EVENT_ID,
  registration_open: false,
  submissions_open: false,
  judging_open: true,
  results_published: false,
  max_team_size: 5,
  min_team_size: 2,
  allow_solo: true,
  timezone: "Asia/Baku",
};
