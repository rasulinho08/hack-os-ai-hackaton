/**
 * The legal pages: the same structure in Azerbaijani, English and Russian,
 * nothing left empty or untranslated, the operator's registered details shown
 * only once they are set, and a cookie table that names keys the code
 * actually uses.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { LEGAL_DOCS, LEGAL_UI } from "@/app/(site)/_legal";
import type { LegalBlock, LegalDoc } from "@/app/(site)/_legal/types";
import { LEGAL_LINKS, LEGAL_UPDATED, legalLabel, legalOperator, operatorLines, type LegalPageId } from "@/lib/legal";
import { CONTACT_EMAIL } from "@/lib/site";

const LANGS = ["en", "az", "ru"] as const;
const PAGES = Object.keys(LEGAL_DOCS) as LegalPageId[];

function strings(doc: LegalDoc): string[] {
  const out = [doc.title, doc.summary, doc.updated];
  for (const s of doc.sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      if (b.kind === "p") out.push(b.text);
      else if (b.kind === "list") out.push(...b.items);
      else out.push(...b.head, ...b.rows.flat());
    }
  }
  return out;
}

const shape = (b: LegalBlock) =>
  b.kind === "p" ? "p" : b.kind === "list" ? `list:${b.items.length}` : `table:${b.head.length}x${b.rows.length}`;
const emailTokens = (doc: LegalDoc) => doc.sections.map((s) => strings({ ...doc, sections: [s] }).join(" ").split("{email}").length - 1);

describe("legal pages", () => {
  it("has the four pages, in footer order, with a label in every language", () => {
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual(["/privacy", "/terms", "/cookies", "/refunds"]);
    expect(PAGES.sort()).toEqual(["cookies", "privacy", "refunds", "terms"]);
    for (const link of LEGAL_LINKS) {
      for (const lang of LANGS) expect(link.label[lang].trim()).not.toBe("");
    }
    expect(legalLabel("terms", "az")).toBe("İstifadə şərtləri");
    expect(legalLabel("terms", "de")).toBe("Terms of use");
  });

  it.each(PAGES)("%s: the same sections, blocks and contact links in AZ, EN and RU", (id) => {
    const en = LEGAL_DOCS[id].en;
    for (const lang of ["az", "ru"] as const) {
      const doc = LEGAL_DOCS[id][lang];
      expect(doc.sections.map((s) => s.id)).toEqual(en.sections.map((s) => s.id));
      expect(doc.sections.map((s) => s.blocks.map(shape))).toEqual(en.sections.map((s) => s.blocks.map(shape)));
      expect(doc.sections.map((s) => Boolean(s.operator))).toEqual(en.sections.map((s) => Boolean(s.operator)));
      expect(emailTokens(doc)).toEqual(emailTokens(en));
      // Cookie and storage names are not translated.
      const keys = (d: LegalDoc) => d.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => r[0]) : [])));
      expect(keys(doc)).toEqual(keys(en));
    }
    // Every page ends with the contact section and its operator block.
    expect(en.sections.at(-1)?.id).toBe("contact");
    expect(en.sections.at(-1)?.operator).toBe(true);
  });

  it.each(PAGES)("%s: no empty text, no stray placeholders, each language in its own script", (id) => {
    for (const lang of LANGS) {
      const doc = LEGAL_DOCS[id][lang];
      for (const text of strings(doc)) {
        expect(text.trim()).not.toBe("");
        // No placeholder but {email}, and nothing that is a dictionary key rather than text.
        expect(text.replaceAll("{email}", "")).not.toMatch(/[{}[\]]/);
        expect(text).not.toMatch(/^[a-z]+(\.[a-z_]+)+$/);
      }
    }
    const az = LEGAL_DOCS[id].az;
    const ru = LEGAL_DOCS[id].ru;
    expect(strings(az).join(" ")).toMatch(/[əğıöüşçİ]/);
    for (const s of ru.sections) expect(s.title).toMatch(/[а-яё]/i);
    for (const [i, s] of az.sections.entries()) expect(s.title).not.toBe(LEGAL_DOCS[id].en.sections[i].title);
  });

  it("dates every page on the same day in every language", () => {
    expect(LEGAL_UPDATED).toBe("2026-10-23");
    for (const id of PAGES) {
      expect(LEGAL_DOCS[id].en.updated).toBe("23 October 2026");
      expect(LEGAL_DOCS[id].az.updated).toBe("23 oktyabr 2026");
      expect(LEGAL_DOCS[id].ru.updated).toBe("23 октября 2026 г.");
    }
    for (const lang of LANGS) expect(Object.values(LEGAL_UI[lang]).every((v) => v.trim() !== "")).toBe(true);
  });
});

describe("the operator's details", () => {
  it("names only the service and the contact address while the registered details are unset", () => {
    const op = legalOperator({});
    expect(op).toMatchObject({ brand: "HackOS", legalName: null, taxId: null, address: null, email: CONTACT_EMAIL });
    expect(operatorLines(op, "en").map((l) => l.key)).toEqual(["service", "email"]);
    // Blank values count as unset: no "[VÖEN]" or empty line ever shows.
    const blank = legalOperator({ NEXT_PUBLIC_LEGAL_NAME: "  ", NEXT_PUBLIC_LEGAL_TAX_ID: "", NEXT_PUBLIC_LEGAL_ADDRESS: undefined });
    expect(operatorLines(blank, "az").map((l) => l.key)).toEqual(["service", "email"]);
  });

  it("adds the legal name, VÖEN and address once they are set, labelled in the reader's language", () => {
    const op = legalOperator({
      NEXT_PUBLIC_LEGAL_NAME: "HackOS MMC",
      NEXT_PUBLIC_LEGAL_TAX_ID: "1234567891",
      NEXT_PUBLIC_LEGAL_ADDRESS: "Bakı, Azərbaycan",
    });
    const az = operatorLines(op, "az");
    expect(az.map((l) => l.key)).toEqual(["service", "legalName", "taxId", "address", "email"]);
    expect(az.find((l) => l.key === "taxId")).toEqual({ key: "taxId", label: "VÖEN", value: "1234567891" });
    expect(operatorLines(op, "ru").find((l) => l.key === "address")?.label).toBe("Адрес");
    expect(operatorLines(op, "xx").find((l) => l.key === "legalName")?.label).toBe("Legal name");
  });
});

describe("the cookie table", () => {
  const root = path.resolve(__dirname, "..", "..");
  const skip = new Set([path.join(root, "src", "app", "(site)", "_legal"), path.join(root, "src", "__tests__")]);
  function source(dir: string): string {
    let out = "";
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (skip.has(p)) continue;
      if (entry.isDirectory()) out += source(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) out += fs.readFileSync(p, "utf8");
    }
    return out;
  }
  const code = source(path.join(root, "src")) + fs.readFileSync(path.join(root, "middleware.ts"), "utf8");
  /* Set and read only by the API (the owner console's second step). */
  const SERVER_ONLY = new Set(["hh_elev"]);

  it("lists only names the web app or the API really uses", () => {
    const names = LEGAL_DOCS.cookies.en.sections
      .flatMap((s) => s.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => r[0]) : [])))
      .flatMap((cell) => cell.split(",").map((n) => n.trim().replace(/…$/, "")));
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      if (SERVER_ONLY.has(name)) continue;
      expect(code.includes(name), `${name} is not used anywhere in src/ or middleware.ts`).toBe(true);
    }
  });
});
