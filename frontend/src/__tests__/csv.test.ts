/**
 * CSV made and read in the browser: formulas are defused, Excel gets its
 * byte-order mark and CRLF, and uploads with quoted line breaks, doubled
 * quotes or semicolons (Excel in AZ/RU settings) read correctly.
 */
import { describe, expect, it } from "vitest";
import { csvCell, toCSV } from "@/lib/csvExport";
import { parseCSV, parseRows } from "@/lib/csvImport";

describe("making CSV", () => {
  it("defuses formulas but leaves numbers alone", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
  });

  it("quotes what needs quoting and joins lists", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(["React", "Go"])).toBe('"React; Go"');
  });

  it("uses CRLF between rows", () => {
    expect(toCSV([{ a: 1, b: "x" }], [{ key: "a", header: "A" }, { key: "b", header: "B" }])).toBe("A,B\r\n1,x");
  });
});

describe("reading CSV", () => {
  it("keeps line breaks and quotes inside quoted cells", () => {
    const rows = parseRows('name,note\r\n"Aysel ""A""","line one\nline two"\r\nRauf,ok\r\n');
    expect(rows).toEqual([["name", "note"], ['Aysel "A"', "line one\nline two"], ["Rauf", "ok"]]);
  });

  it("reads semicolon files from Excel and drops the byte-order mark", () => {
    expect(parseCSV("﻿Email;Ad Soyad\naysel@example.az;Aysel Məmmədova\n")).toEqual([
      { Email: "aysel@example.az", "Ad Soyad": "Aysel Məmmədova" },
    ]);
  });

  it("ignores empty lines", () => {
    expect(parseCSV("a,b\n\n1,2\n,\n")).toEqual([{ a: "1", b: "2" }]);
  });
});
