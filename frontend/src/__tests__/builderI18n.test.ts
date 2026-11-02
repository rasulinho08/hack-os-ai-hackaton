/**
 * Every builder and event-page string exists in all three languages, and
 * every key the components ask for is defined (dynamic keys are expanded
 * from the same lists the API uses).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/builder/en";
import az from "@/lib/i18n/builder/az";
import ru from "@/lib/i18n/builder/ru";
import { FILE_CODES, REGISTER_CODES } from "@/lib/builder/registrationCheck";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const SOURCES = [
  ...walk(join(__dirname, "..", "components", "builder")),
  ...walk(join(__dirname, "..", "components", "event-page")),
  join(__dirname, "..", "lib", "builder", "registrationCheck.ts"),
  join(__dirname, "..", "app", "create-event", "page.tsx"),
  join(__dirname, "..", "app", "create-event", "[id]", "page.tsx"),
  join(__dirname, "..", "app", "e", "[slug]", "register", "page.tsx"),
  join(__dirname, "..", "app", "join", "[eventCode]", "JoinCodeNotFound.tsx"),
];

const DYNAMIC: Record<string, string[]> = {
  "b.auto.": ["reg24", "regclosed", "start30", "started", "sub24", "sub1", "subclosed", "pres1", "results", "certs"],
  "b.category.": ["hackathon", "ideathon", "datathon", "designathon", "gamejam", "case", "other"],
  "b.cert.": ["participation", "winners", "special", "judge", "mentor", "volunteer"],
  "b.check.": [
    "name_missing", "tagline_missing", "description_short", "logo_missing", "banner_missing", "venue_missing", "city_missing",
    "online_url_missing", "dates_missing", "registration_window_missing", "timeline_order", "starts_in_past", "registration_closed",
    "submission_deadline_missing", "team_size_too_small", "capacity_capped_by_plan", "students_need_university", "age_limit_needs_age",
    "country_limit_needs_country", "rules_missing", "field_options_missing", "prizes_missing", "criteria_missing", "judges_missing",
    "signer_missing", "faq_missing",
  ],
  "b.elig.needs_": ["age", "country", "university"],
  "b.faq.": ["who", "cost", "team", "bring", "judging", "online"],
  "b.field.": ["phone", "age", "gender", "country", "city", "university", "major", "company", "linkedin", "github", "cv", "tshirt", "diet", "source", "experience", "skills", "motivation"],
  "b.ftype.": ["text", "textarea", "select", "multiselect", "checkbox", "number", "date", "url", "file"],
  "b.group.": ["basics", "people", "content", "judging", "team", "day", "comms", "finish"],
  "b.plan.": ["starter", "professional", "business", "enterprise"],
  "b.schedule.phase_": ["registration", "teams", "hacking", "judging", "results"],
  "b.share.ch_": ["instagram", "linkedin", "telegram", "whatsapp", "facebook", "email"],
  "b.subs.": ["required", "optional", "off"],
  "b.subs.f_": ["repo", "demo", "slides", "video", "summary", "tech"],
  "b.subs.type_": ["pdf", "pptx", "docx", "zip", "image"],
  "b.tier.": ["platinum", "gold", "silver", "bronze", "partner"],
  "b.when.": ["team_deadline", "judging_start", "judging_end", "demo_day", "results_at"],
  "ep.tl.": ["reg_open", "reg_close", "teams", "start", "submission", "end", "demo", "judging", "results"],
  "ep.nav.": ["about", "timeline", "tracks", "prizes", "judging", "who", "sponsors", "rules", "faq"],
  "rg.field.": ["phone", "age", "gender", "country", "city", "university", "major", "company", "linkedin", "github", "cv", "tshirt", "diet", "source", "experience", "skills", "motivation"],
  "rg.opt.gender.": ["female", "male", "other", "prefer_not"],
  "rg.opt.diet.": ["none", "vegetarian", "vegan", "halal", "gluten_free", "lactose_free", "nut_allergy", "other"],
  "rg.opt.source.": ["social", "friend", "university", "email", "website", "telegram", "other"],
  "rg.opt.experience.": ["beginner", "intermediate", "advanced", "expert"],
  "rg.api.": [...REGISTER_CODES],
  "rg.file.": [...FILE_CODES],
  "rg.done.": ["approved", "pending", "waitlisted", "approved_body", "pending_body", "waitlisted_body"],
  "rg.state.mine_": ["approved", "pending", "waitlisted", "rejected"],
  "rg.join.": ["ALREADY_IN_TEAM", "TEAM_FULL", "TEAM_NOT_FOUND", "TEAM_FORMATION_CLOSED", "TEAM_ELIMINATED"],
};
const SECTIONS = ["basics", "brand", "place", "schedule", "registration", "eligibility", "form", "tracks", "prizes", "sponsors", "judging", "judges", "mentors", "volunteers", "submissions", "presentation", "communication", "resources", "certificates", "share"];

describe("builder strings", () => {
  it("are the same set of keys in AZ, EN and RU", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(az).sort()).toEqual(keys);
    expect(Object.keys(ru).sort()).toEqual(keys);
  });

  it("are never empty and keep their {placeholders}", () => {
    for (const k of Object.keys(en)) {
      const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
      for (const dict of [az, ru]) {
        expect(dict[k]?.trim().length, k).toBeGreaterThan(0);
        expect(ph(dict[k]), k).toBe(ph(en[k]));
      }
    }
  });

  it("cover every key the components use", () => {
    const used = new Set<string>();
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\b[tf]\(\s*"((?:b|ep|rg)\.[^"]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bkey:\s*"(rg\.[^"]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/resolve\([^,]+,\s*"((?:b|ep|rg)\.[^"]+)"/g)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    for (const s of SECTIONS) for (const p of ["b.sec.", "b.secdesc.", "b.used."]) used.add(p + s);
    for (const r of ["judge", "mentor", "volunteer"]) for (const sfx of ["_invite", "_invite_help", "_list"]) used.add(`b.staff.${r}${sfx}`);
    for (const t of ["hackathon24", "university", "ideathon", "blank"]) { used.add(`b.tpl.${t}`); used.add(`b.tpl.${t}_desc`); }
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
  });
});
