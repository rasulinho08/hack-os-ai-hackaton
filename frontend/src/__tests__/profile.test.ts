/**
 * The participant's record and public profile helpers, the report card's
 * helpers, and their strings: every key the new pages ask for exists in AZ,
 * EN and RU with the same {placeholders}.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/profile/en";
import az from "@/lib/i18n/profile/az";
import ru from "@/lib/i18n/profile/ru";
import wrapEn from "@/lib/i18n/wrapup/en";
import wrapAz from "@/lib/i18n/wrapup/az";
import wrapRu from "@/lib/i18n/wrapup/ru";
import builderEn from "@/lib/i18n/builder/en";
import builderAz from "@/lib/i18n/builder/az";
import builderRu from "@/lib/i18n/builder/ru";
import { resolve } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import {
  ROLES, byDateDesc, cleanHandle, eventDatesOf, isHandle, normalizeMyHackathons, normalizePublicProfile, normalizeSettings, summaryOf,
} from "@/lib/profile";
import { normalizeReportSummary, npsText, reportPdfPath, reportStateOf } from "@/lib/report";

describe("my hackathons", () => {
  const raw = {
    events: [
      {
        event: { id: 7, name: "Caspian AI", slug: "caspian-ai", startDate: "2026-10-17T20:30:00Z", endDate: "2026-10-19T14:00:00Z", timezone: "Asia/Baku", organiser: "CTU" },
        role: "lead", status: "approved", team: { name: "Neural Nomads" },
        project: { name: "MetroMind", tech: "Python", publicUrl: "/e/caspian-ai/projects" },
        result: { published: true, place: 1, of: 17, prizes: [{ name: "Grand prize", kind: "place", value: "5 000 AZN" }] },
        shareable: true,
      },
      {
        event: { id: 8, name: "Internal", slug: null, startDate: "2026-09-01T10:00:00Z" },
        role: "nonsense", status: "pending", project: { name: "X", publicUrl: "https://evil.example/" }, result: {},
      },
      { event: { name: "" }, role: "lead" },
    ],
    certificates: [
      { code: "CAS1-AI26-WIN1", kind: "winner", place: 1, event: { id: 7, name: "Caspian AI" }, verifyUrl: "https://evil.example/verify" },
      { code: "not a code" },
    ],
  };

  it("reads the record, keeping only what the page may follow", () => {
    const d = normalizeMyHackathons(raw);
    expect(d.events).toHaveLength(2);
    const [a, b] = d.events;
    expect(a.role).toBe("lead");
    expect(a.project).toEqual({ name: "MetroMind", tech: "Python", publicUrl: "/e/caspian-ai/projects" });
    expect(a.result).toEqual({ published: true, place: 1, of: 17, prizes: [{ name: "Grand prize", kind: "place", value: "5 000 AZN" }] });
    expect(b.role).toBe("member");
    expect(b.project?.publicUrl).toBeNull();
    expect(d.certificates).toHaveLength(1);
    // The verification page is always this site's, whatever the API named.
    expect(d.certificates[0].verifyUrl).toBe("/verify/CAS1-AI26-WIN1");
    expect(d.certificates[0].pdfUrl).toBe("/api/public/certificates/CAS1-AI26-WIN1/pdf");
  });

  it("counts what the person actually took part in, newest first", () => {
    const d = normalizeMyHackathons(raw);
    expect(summaryOf(d.events, d.certificates)).toEqual({ events: 1, projects: 1, prizes: 1, certificates: 1 });
    expect(byDateDesc(d.events).map((e) => e.event.name)).toEqual(["Caspian AI", "Internal"]);
    expect(eventDatesOf(d.events[0].event, "en")).toBe("18–19 October 2026");
  });
});

describe("the public profile", () => {
  it("handles: cleaned as typed, checked like the API", () => {
    expect(cleanHandle("Aysel Məmmədova!!")).toBe("aysel-m-mm-dova-");
    expect(isHandle("aysel-m")).toBe(true);
    for (const bad of ["ab", "-ab", "ab-", "a--b", "A-B", "x".repeat(31)]) expect(isHandle(bad), bad).toBe(false);
  });

  it("settings: everything off unless the API says on", () => {
    const s = normalizeSettings({ handle: "aysel", suggestedHandle: "aysel", path: "javascript:alert(1)" });
    expect(s).toMatchObject({ enabled: false, showName: false, showEvents: false, showProjects: false, showCertificates: false, path: null });
    expect(normalizeSettings({ enabled: true, handle: "aysel", path: "/u/aysel", hiddenEventIds: [3, "x", -1] })).toMatchObject({ enabled: true, path: "/u/aysel", hiddenEventIds: [3] });
  });

  it("a part that is not shown stays absent, and nothing but the shown fields survives", () => {
    const p = normalizePublicProfile({ handle: "aysel", name: "Aysel", headline: null, email: "a@b.c", phone: "+994" })!;
    expect(p).toEqual({ handle: "aysel", name: "Aysel", headline: null, indexable: false, updatedAt: null });
    const q = normalizePublicProfile({
      handle: "aysel", name: null,
      projects: [{ name: "MetroMind", event: { name: "Caspian AI" }, place: 1, prizes: [], url: "//evil.example/e/x/projects" }],
      certificates: [{ code: "CAS1-AI26-WIN1", kind: "winner", eventName: "Caspian AI", verifyUrl: "https://evil.example" }],
    })!;
    expect(q.events).toBeUndefined();
    expect(q.projects?.[0].url).toBeNull();
    expect(q.certificates?.[0].verifyUrl).toBe("/verify/CAS1-AI26-WIN1");
    expect(normalizePublicProfile({ handle: "../x" })).toBeNull();
  });
});

describe("the report card", () => {
  it("reads the figures and builds the PDF address", () => {
    const s = normalizeReportSummary({ language: "ru", funnel: { registrations: 97, approved: 79, checkedIn: null, teams: 20, projects: 17 }, feedback: { nps: { score: 27 } }, branding: { branded: true } });
    expect(s).toEqual({ language: "ru", registrations: 97, approved: 79, checkedIn: null, teams: 20, projects: 17, nps: 27, branded: true });
    expect(normalizeReportSummary({}).language).toBe("az");
    expect(reportPdfPath(5, "en")).toBe("/api/events/5/report/pdf?lang=en");
    expect(reportPdfPath(5, "az", true)).toBe("/api/events/5/report/pdf?lang=az&inline=1");
    expect([npsText(27), npsText(0), npsText(-12), npsText(null)]).toEqual(["+27", "0", "−12", "—"]);
  });

  it("tells a locked plan from an event that is not over", () => {
    expect(reportStateOf(new ApiError("x", 403, [], "MODULE_DISABLED"))).toBe("locked");
    expect(reportStateOf(new ApiError("x", 409, [], "EVENT_NOT_OVER"))).toBe("not_over");
    expect(reportStateOf(new Error("boom"))).toBe("failed");
  });
});

describe("strings", () => {
  const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
  const sets = [
    ["profile", en, az, ru, () => true],
    ["report", wrapEn, wrapAz, wrapRu, (k: string) => k.startsWith("rp.")],
    ["visibility", builderEn, builderAz, builderRu, (k: string) => /^b\.share\.(vis|directory|visibility)|^ep\.(cta\.invite|invite_note)|^rg\.api\.INVITE_ONLY/.test(k)],
  ] as const;

  it.each(sets)("%s: the same keys and {placeholders} in AZ, EN and RU, none empty", (_, e, a, r, pick) => {
    const keys = Object.keys(e).filter(pick).sort();
    expect(keys.length).toBeGreaterThan(0);
    for (const m of [a, r]) {
      expect(Object.keys(m).filter(pick).sort()).toEqual(keys);
      for (const k of keys) {
        expect(ph(String(m[k])), k).toBe(ph(String(e[k])));
        expect(String(m[k]).trim(), k).not.toBe("");
      }
    }
  });

  it("every key the new pages use is defined", () => {
    const root = join(__dirname, "..");
    const files = [
      "app/hacker/hackathons/page.tsx", "app/(site)/u/[handle]/ProfileView.tsx", "app/(site)/u/[handle]/page.tsx",
      "components/wrapup/ReportCard.tsx", "components/builder/sections/share.tsx", "components/event-page/EventPublicView.tsx",
    ];
    const dynamic: Record<string, string[]> = {
      "pf.role.": ROLES, "pf.status.": ["pending", "waitlisted", "eliminated"], "pf.stat.": ["events", "projects", "prizes", "certificates"], "rp.lang.": ["az", "en", "ru"],
    };
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf8");
      // Static keys: t("pf.title"); the ones built from a list are checked below.
      for (const m of src.matchAll(/(?:t|resolve)\((?:"en", )?["']((?:pf|rp|b\.share|ep)\.[a-zA-Z_.]+)["']/g)) {
        for (const lang of ["en", "az", "ru"] as const) expect(resolve(lang, m[1]), `${lang}:${m[1]} in ${f}`).not.toBe(m[1]);
      }
    }
    for (const [prefix, list] of Object.entries(dynamic)) {
      for (const x of list) for (const lang of ["en", "az", "ru"] as const) expect(resolve(lang, prefix + x), `${lang}:${prefix}${x}`).not.toBe(prefix + x);
    }
  });
});
