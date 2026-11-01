/** Participant registration & profile types */

/* ─── Team Member (added by team lead during registration) ─── */
export interface TeamMemberInfo {
  name: string;
  email: string;
}

/* ─── Team Lead Registration form data ─── */
export interface TeamLeadRegistration {
  /* Step 1 — Personal */
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  age: number;
  phone: string;

  /* Step 2 — Profile & Skills */
  country: string;
  timezone: string;
  attendanceMode: "online" | "offline";
  linkedIn: string;
  github: string;
  experience: "beginner" | "intermediate" | "advanced" | "expert";
  skills: string[];
  role: string;
  university: string;
  cohort: string;

  /* Step 3 — Team & Extras */
  teamName: string;
  members: TeamMemberInfo[];
  dietary: string;
  tshirtSize: string;
  motivation: string;
  howHeard: string;
  codeOfConduct: boolean;
}

/* ─── Stored Participant (after registration) ─── */
export interface Participant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  phone: string;
  country: string;
  timezone: string;
  attendanceMode: "online" | "offline";
  linkedIn: string;
  github: string;
  experience: "beginner" | "intermediate" | "advanced" | "expert";
  skills: string[];
  role: string;
  university: string;
  cohort: string;
  dietary: string;
  tshirtSize: string;
  motivation: string;
  howHeard: string;
  isTeamLead: boolean;
  isSolo?: boolean;
  team: string;
  status: "approved" | "pending" | "rejected";
  registeredAt: string;
}

/* ─── Constants ─── */

export const COUNTRIES = [
  "Azerbaijan", "Turkey", "United States", "United Kingdom", "Germany", "France",
  "Canada", "Australia", "Japan", "South Korea", "India", "Brazil", "Russia",
  "China", "UAE", "Saudi Arabia", "Georgia", "Ukraine", "Poland", "Netherlands",
  "Sweden", "Norway", "Finland", "Denmark", "Spain", "Italy", "Portugal",
  "Switzerland", "Austria", "Belgium", "Czech Republic", "Romania", "Hungary",
  "Israel", "Singapore", "Malaysia", "Indonesia", "Philippines", "Vietnam",
  "Thailand", "Mexico", "Argentina", "Colombia", "Chile", "Nigeria", "Kenya",
  "South Africa", "Egypt", "Morocco", "Pakistan", "Bangladesh", "Other",
];

export const TIMEZONES = [
  "UTC-12:00", "UTC-11:00", "UTC-10:00", "UTC-09:00", "UTC-08:00 (PST)",
  "UTC-07:00 (MST)", "UTC-06:00 (CST)", "UTC-05:00 (EST)", "UTC-04:00 (AST)",
  "UTC-03:00", "UTC-02:00", "UTC-01:00", "UTC+00:00 (GMT)", "UTC+01:00 (CET)",
  "UTC+02:00 (EET)", "UTC+03:00 (MSK)", "UTC+03:30", "UTC+04:00 (AZT)",
  "UTC+04:30", "UTC+05:00", "UTC+05:30 (IST)", "UTC+05:45", "UTC+06:00",
  "UTC+06:30", "UTC+07:00", "UTC+08:00 (CST)", "UTC+09:00 (JST)",
  "UTC+09:30", "UTC+10:00 (AEST)", "UTC+11:00", "UTC+12:00",
];

export const SKILL_OPTIONS = [
  "JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "Go", "Rust",
  "Ruby", "PHP", "Swift", "Kotlin", "React", "Next.js", "Vue.js", "Angular",
  "Node.js", "Express", "Django", "Flask", "Spring Boot", "FastAPI",
  "PostgreSQL", "MongoDB", "MySQL", "Redis", "Docker", "Kubernetes", "AWS",
  "GCP", "Azure", "Firebase", "Supabase", "GraphQL", "REST API",
  "Machine Learning", "AI / LLM", "Computer Vision", "NLP", "Data Science",
  "Blockchain", "Web3", "Mobile (React Native)", "Mobile (Flutter)",
  "DevOps / CI/CD", "UI/UX Design", "Figma", "Game Development", "IoT",
  "Cybersecurity", "AR/VR",
];

export const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner (0–1 il)" },
  { value: "intermediate", label: "Intermediate (1–3 il)" },
  { value: "advanced", label: "Advanced (3–5 il)" },
  { value: "expert", label: "Expert (5+ il)" },
] as const;

export const ROLE_OPTIONS = [
  "Developer", "Designer", "PM", "Data Scientist", "DevOps", "Other",
];

export const DIETARY_OPTIONS = [
  "Yoxdur", "Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-Free",
  "Lactose-Free", "Nut Allergy", "Digər",
];

export const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

export const HOW_HEARD_OPTIONS = [
  "Sosial media", "Dostdan", "Universitetdən", "Email", "Web saytdan", "Digər",
];

export const DEFAULT_REGISTRATION: TeamLeadRegistration = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  age: 0,
  phone: "+994",
  country: "",
  timezone: "",
  attendanceMode: "online",
  linkedIn: "",
  github: "",
  experience: "beginner",
  skills: [],
  role: "Developer",
  university: "",
  cohort: "",
  teamName: "",
  members: [],
  dietary: "Yoxdur",
  tshirtSize: "M",
  motivation: "",
  howHeard: "",
  codeOfConduct: false,
};
