/**
 * The registration form's own checks mirror the API's rules, so people read
 * what to fix in their language before anything is sent.
 */
import { describe, expect, it } from "vitest";
import { checkRegistration, normaliseCity, normaliseLink, type RegistrationInput } from "@/lib/builder/registrationCheck";
import type { PublicField } from "@/lib/builder/public";

const fld = (key: string, type: string, extra: Partial<PublicField> = {}): PublicField => ({
  id: 1, key, kind: "standard", type, label: null, help: null, options: [], required: false, ...extra,
});

const base = (over: Partial<RegistrationInput> = {}): RegistrationInput => ({
  form: [],
  eligibility: { minAge: null, maxAge: null, countries: [], cities: [], studentsOnly: false, requireRules: false, requireCoc: false },
  signedIn: false,
  account: { fullName: "Aysel Məmmədova", email: "aysel@example.az", password: "secret123" },
  entry: { type: "solo", teamName: "", teamCode: "" },
  answers: {},
  accept: { rules: false, coc: false },
  ...over,
});

describe("registration checks", () => {
  it("accept a complete answer with Azerbaijani letters in the name", () => {
    expect(checkRegistration(base())).toEqual({});
  });

  it("name the account problems the API would refuse", () => {
    const p = checkRegistration(base({ account: { fullName: "A", email: "not-an-email", password: "short" } }));
    expect(p["account.fullName"].key).toBe("rg.err.name");
    expect(p["account.email"].key).toBe("rg.err.email");
    expect(p["account.password"].key).toBe("rg.err.password");
    expect(checkRegistration(base({ account: { fullName: "Ali", email: "a@b.az", password: "longenough" } }))["account.password"].key).toBe("rg.err.password_digit");
    expect(checkRegistration(base({ account: { fullName: "<b>Ali</b>", email: "a@b.az", password: "secret123" } }))["account.fullName"].key).toBe("rg.err.no_brackets");
  });

  it("skip the account when someone is signed in", () => {
    expect(checkRegistration(base({ signedIn: true, account: { fullName: "", email: "", password: "" } }))).toEqual({});
  });

  it("check the team name for leads and the code for members", () => {
    expect(checkRegistration(base({ entry: { type: "lead", teamName: "x", teamCode: "" } }))["entry.teamName"].key).toBe("rg.err.team_name");
    expect(checkRegistration(base({ entry: { type: "lead", teamName: "Kod Ustaları", teamCode: "" } }))).toEqual({});
    expect(checkRegistration(base({ entry: { type: "member", teamName: "", teamCode: "ab" } }))["entry.teamCode"].key).toBe("rg.err.team_code");
    expect(checkRegistration(base({ entry: { type: "member", teamName: "", teamCode: "a1b2c3d4" } }))).toEqual({});
  });

  it("require required questions, including a ticked checkbox", () => {
    const form = [fld("phone", "phone", { required: true }), fld("ok", "checkbox", { required: true, kind: "custom" })];
    const p = checkRegistration(base({ form, answers: { ok: false } }));
    expect(p["answers.phone"].key).toBe("rg.err.required");
    expect(p["answers.ok"].key).toBe("rg.err.confirm");
  });

  it("check values by type like the API", () => {
    const form = [
      fld("phone", "phone"), fld("age", "number", { min: 10, max: 99 }), fld("github", "url"),
      fld("tshirt", "select", { options: ["S", "M"] }), fld("country", "country"),
    ];
    const bad = checkRegistration(base({ form, answers: { phone: "12", age: 7, github: "http://", tshirt: "XXL", country: "Azerbaijan" } }));
    expect(bad["answers.phone"].key).toBe("rg.err.phone");
    expect(bad["answers.age"]).toEqual({ key: "rg.err.number", params: { min: 10, max: 99 } });
    expect(bad["answers.github"].key).toBe("rg.err.url");
    expect(bad["answers.tshirt"].key).toBe("rg.err.option");
    expect(bad["answers.country"].key).toBe("rg.err.country");
    const good = checkRegistration(base({ form, answers: { phone: "+994 50 123 45 67", age: 21, github: "octocat", tshirt: "M", country: "AZ" } }));
    expect(good).toEqual({});
  });

  it("apply eligibility: age, countries, cities and students only", () => {
    const form = [fld("age", "number", { min: 10, max: 99 }), fld("country", "country"), fld("city", "text"), fld("university", "university")];
    const eligibility = { minAge: 16, maxAge: 25, countries: ["AZ"], cities: ["Bakı", "Gəncə"], studentsOnly: true, requireRules: false, requireCoc: false };
    const p = checkRegistration(base({ form, eligibility, answers: { age: 30, country: "TR", city: "Ankara" } }));
    expect(p["answers.age"]).toEqual({ key: "rg.err.age_between", params: { min: 16, max: 25 } });
    expect(p["answers.country"].key).toBe("rg.err.country_not_open");
    expect(p["answers.city"].key).toBe("rg.err.city_not_open");
    expect(p["answers.university"].key).toBe("rg.err.students_only");
    // "Baki" is the same city as "Bakı".
    expect(checkRegistration(base({ form, eligibility, answers: { age: 20, country: "AZ", city: "Baki", university: "ADA University" } }))).toEqual({});
  });

  it("ask for the rules and the code of conduct when the event does", () => {
    const eligibility = { minAge: null, maxAge: null, countries: [], cities: [], studentsOnly: false, requireRules: true, requireCoc: true };
    const p = checkRegistration(base({ eligibility }));
    expect(p["accept.rules"].key).toBe("rg.err.rules");
    expect(p["accept.coc"].key).toBe("rg.err.coc");
    expect(checkRegistration(base({ eligibility, accept: { rules: true, coc: true } }))).toEqual({});
  });
});

describe("normalising like the API", () => {
  it("turns a GitHub or LinkedIn handle into a link", () => {
    expect(normaliseLink("octocat", "github")).toBe("https://github.com/octocat");
    expect(normaliseLink("@octocat", "github")).toBe("https://github.com/octocat");
    expect(normaliseLink("aysel-m", "linkedin")).toBe("https://www.linkedin.com/in/aysel-m");
    expect(normaliseLink("example.az/about", "url")).toBe("https://example.az/about");
    expect(normaliseLink("javascript:alert(1)", "url")).toBeUndefined();
  });

  it("compares cities across alphabets", () => {
    expect(normaliseCity("Bakı")).toBe(normaliseCity("BAKI"));
    expect(normaliseCity("Şəki")).toBe("seki");
    expect(normaliseCity("Баку")).toBe("baku");
  });
});

describe("a personal invitation that names an existing team", () => {
  it("joins it without a code; a code typed instead is still checked", () => {
    const member = (teamCode: string, invitedTeam: boolean) => base({ entry: { type: "member", teamName: "", teamCode }, invitedTeam });
    expect(checkRegistration(member("", true))).toEqual({});
    expect(checkRegistration(member("", false))["entry.teamCode"].key).toBe("rg.err.team_code");
    expect(checkRegistration(member("x", true))["entry.teamCode"].key).toBe("rg.err.team_code");
    expect(checkRegistration(member("a1b2c3d4", true))).toEqual({});
  });
});
