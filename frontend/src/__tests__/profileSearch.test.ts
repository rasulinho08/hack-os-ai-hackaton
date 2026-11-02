/**
 * "Let search engines show my profile": off unless its owner said so, only
 * while the profile is on; when on, the page carries a description and
 * structured data made of the parts the person chose to show — never an
 * e-mail, a phone number or an id.
 */
import { describe, expect, it } from "vitest";
import { normalizePublicProfile, normalizeSettings, profileDescription, profileJsonLd } from "@/lib/profile";
import { resolve } from "@/lib/i18n";

const t = (k: string) => resolve("en", k);
const raw = {
  handle: "aysel", name: "Aysel Məmmədova", headline: null, indexable: true, updatedAt: "2026-10-20T10:00:00Z",
  email: "aysel@example.az", phone: "+994501112233", id: 42,
  events: [{ event: { name: "Caspian AI", slug: "caspian-ai" }, role: "lead", team: "Owls" }],
  projects: [{ name: "MetroMind", team: "Owls", event: { name: "Caspian AI", slug: "caspian-ai" }, place: 1, prizes: [{ name: "Grand prize", kind: "place", value: "1000 AZN" }], url: "/e/caspian-ai/projects" }],
  certificates: [{ code: "CAS1-AI26-WIN1", kind: "winner", place: 1, title: "Grand prize", eventName: "Caspian AI", issuedAt: "2026-10-21T10:00:00Z" }],
};

describe("the settings", () => {
  it("are off by default and only on while the profile is on", () => {
    expect(normalizeSettings({}).indexable).toBe(false);
    expect(normalizeSettings({ enabled: false, indexable: true }).indexable).toBe(false);
    expect(normalizeSettings({ enabled: true, indexable: true }).indexable).toBe(true);
  });
});

describe("the public page", () => {
  it("not indexable: no structured data", () => {
    const p = normalizePublicProfile({ ...raw, indexable: false })!;
    expect(p.indexable).toBe(false);
    expect(profileJsonLd(p, "https://www.hack-os.app")).toBeNull();
  });

  it("indexable: a Person with only what was shown", () => {
    const p = normalizePublicProfile(raw)!;
    const ld = profileJsonLd(p, "https://www.hack-os.app")!;
    expect(ld["@type"]).toBe("ProfilePage");
    expect(ld.url).toBe("https://www.hack-os.app/u/aysel");
    const person = ld.mainEntity as Record<string, unknown>;
    expect(person).toMatchObject({ "@type": "Person", name: "Aysel Məmmədova", url: "https://www.hack-os.app/u/aysel", award: ["Grand prize — Caspian AI"] });
    expect((person.hasCredential as { url: string }[])[0].url).toBe("https://www.hack-os.app/verify/CAS1-AI26-WIN1");
    const text = JSON.stringify(ld);
    expect(text).not.toMatch(/@example|994501112233|"id"/);
  });

  it("without the name, the handle; without projects or certificates, none of them", () => {
    const p = normalizePublicProfile({ handle: "aysel", name: null, headline: "Data person", indexable: true })!;
    const person = profileJsonLd(p, "https://x.test")!.mainEntity as Record<string, unknown>;
    expect(person).toEqual({ "@type": "Person", alternateName: "@aysel", description: "Data person", url: "https://x.test/u/aysel" });
  });

  it("describes itself by the headline, else by what it shows", () => {
    expect(profileDescription(normalizePublicProfile({ ...raw, headline: "Builder of things" })!, t)).toBe("Builder of things");
    expect(profileDescription(normalizePublicProfile(raw)!, t)).toBe("Hackathons: 1 · Projects: 1 · Certificates: 1 — HackOS");
    expect(profileDescription(normalizePublicProfile({ handle: "aysel" })!, t)).toBe(t("pf.u.meta_description"));
  });
});
