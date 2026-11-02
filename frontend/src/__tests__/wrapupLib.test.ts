/**
 * The arithmetic and the readers behind certificates, NPS and the archive:
 * codes typed any which way, the API's answers made safe, the NPS score and
 * its shares, and when an event is archived by itself.
 */
import { describe, expect, it } from "vitest";
import {
  isCodeShape, kindOf, linkedInAddUrl, normaliseCode, normalizeCertificates, normalizeMine, normalizePlan, normalizePublic, ordinal,
  publicPdfPath, verifyPath, verifyUrl,
} from "@/lib/certificates";
import { bandOf, normalizeNpsState, normalizeNpsSummary, npsScore, scorePosition, scoreTone, shares, signed } from "@/lib/nps";
import { ARCHIVE_AFTER_DAYS, archiveStateOf, autoArchiveAt, exportPath, isArchivedEvent } from "@/lib/archive";
import { resolveWrapupDemo } from "@/lib/demo/wrapup";

const DAY = 86400e3;

describe("certificate codes", () => {
  it("come back in the XXXX-XXXX-XXXX shape however they were typed", () => {
    expect(normaliseCode("abcd-efgh-jklm")).toBe("ABCD-EFGH-JKLM");
    expect(normaliseCode(" ABCDEFGHJKLM ")).toBe("ABCD-EFGH-JKLM");
    expect(normaliseCode("ab cd ef gh jk lm")).toBe("ABCD-EFGH-JKLM");
    expect(normaliseCode("ABCD--EFGH__JKLM")).toBe("ABCD-EFGH-JKLM");
    expect(isCodeShape(normaliseCode("abcd-efgh-jklm"))).toBe(true);
  });

  it("do not pretend a wrong length is a code", () => {
    expect(normaliseCode("ABC")).toBe("ABC");
    expect(isCodeShape(normaliseCode("ABCD-EFGH-JKL"))).toBe(false);
    expect(isCodeShape(normaliseCode("' OR 1=1 --"))).toBe(false);
    expect(normaliseCode(null)).toBe("");
  });

  it("make the paths the API and the check page answer on", () => {
    expect(verifyPath("ABCD-EFGH-JKLM")).toBe("/verify/ABCD-EFGH-JKLM");
    expect(publicPdfPath("ABCD-EFGH-JKLM")).toBe("/api/public/certificates/ABCD-EFGH-JKLM/pdf");
    expect(verifyUrl("ABCD-EFGH-JKLM", "https://hack-os.app/")).toBe("https://hack-os.app/verify/ABCD-EFGH-JKLM");
  });
});

describe("certificate kinds and places", () => {
  it("accept the builder's spelling and the stored one", () => {
    expect(kindOf("winners")).toBe("winner");
    expect(kindOf("winner")).toBe("winner");
    expect(kindOf("Judge")).toBe("judge");
    expect(kindOf("diploma")).toBeNull();
  });

  it("word places as the certificate does", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map((n) => ordinal("en", n))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
    expect([1, 2, 3, 6, 9, 10, 20, 40, 100].map((n) => ordinal("az", n))).toEqual(["1-ci", "2-ci", "3-cü", "6-cı", "9-cu", "10-cu", "20-ci", "40-cı", "100-cü"]);
    expect(ordinal("ru", 2)).toBe("2-е");
  });
});

describe("the API's answers", () => {
  it("the organiser's list keeps what the table needs and drops broken rows", () => {
    const rows = normalizeCertificates([
      { id: 5, code: "ABCD-EFGH-JKLM", kind: "winner", place: 1, title: "Grand prize", name: "Aysel", email: "a@x.az", teamName: "Kod", userId: 9, issuedAt: "2026-10-01T10:00:00Z", emailedAt: null, revokedAt: null },
      { id: 6, code: "ZZZZ-ZZZZ-ZZZZ", kind: "nonsense" },
      { code: "no-id", kind: "judge" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 5, kind: "winner", place: 1, title: "Grand prize", teamName: "Kod", emailedAt: null });
  });

  it("the plan counts by kind when the API did not", () => {
    const p = normalizePlan({
      kinds: ["participation", "winners"],
      needsResults: true,
      items: [
        { kind: "participation", userId: 1, name: "A", state: "issued" },
        { kind: "participation", userId: 2, name: "B", state: "new" },
        { kind: "participation", userId: 3, name: "C", state: "weird" },
      ],
    });
    expect(p.kinds).toEqual(["participation", "winner"]);
    expect(p.byKind.participation).toEqual({ total: 3, new: 2 });
    expect(p.toIssue).toBe(2);
    expect(p.needsResults).toBe(true);
  });

  it("a person's own and the public check", () => {
    const mine = normalizeMine([{ code: "ABCD-EFGH-JKLM", kind: "participation", event: { id: 3, name: "Baku AI" }, teamName: "Kod" }]);
    expect(mine[0]).toMatchObject({ eventId: 3, eventName: "Baku AI", teamName: "Kod" });
    const pub = normalizePublic({ code: "ABCD-EFGH-JKLM", kind: "special", name: "Aysel", title: "Best design", revoked: true, event: { name: "Baku AI", slug: null } });
    expect(pub).toMatchObject({ kind: "special", revoked: true, title: "Best design", event: { name: "Baku AI", slug: null } });
    expect(normalizePublic({ kind: "special" })).toBeNull();
  });

  it("LinkedIn's form gets the name, the organisation, the date and the link", () => {
    const url = new URL(linkedInAddUrl({ name: "Winner — Baku AI", organisation: "Baku AI", issuedAt: "2026-10-05T10:00:00Z", code: "ABCD-EFGH-JKLM", url: "https://hack-os.app/verify/ABCD-EFGH-JKLM" }));
    expect(url.hostname).toBe("www.linkedin.com");
    expect(url.searchParams.get("startTask")).toBe("CERTIFICATION_NAME");
    expect(url.searchParams.get("name")).toBe("Winner — Baku AI");
    expect(url.searchParams.get("issueYear")).toBe("2026");
    expect(url.searchParams.get("issueMonth")).toBe("10");
    expect(url.searchParams.get("certId")).toBe("ABCD-EFGH-JKLM");
  });
});

describe("NPS", () => {
  it("bands and the score", () => {
    expect([0, 6, 7, 8, 9, 10].map(bandOf)).toEqual(["detractor", "detractor", "passive", "passive", "promoter", "promoter"]);
    expect(npsScore([10, 9, 8, 3])).toBe(25);
    expect(npsScore([0, 0, 10])).toBe(-33);
    expect(npsScore([])).toBeNull();
    expect(npsScore([11, -1])).toBeNull();
  });

  it("shares always add up to 100", () => {
    expect(shares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(shares([2, 1, 0]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("where a score sits, how it reads, how it is written", () => {
    expect(scorePosition(-100)).toBe(0);
    expect(scorePosition(0)).toBe(50);
    expect(scorePosition(100)).toBe(100);
    expect(scoreTone(null)).toBe("neutral");
    expect(scoreTone(-5)).toBe("danger");
    expect(scoreTone(12)).toBe("warn");
    expect(scoreTone(30)).toBe("ok");
    expect(signed(42)).toBe("+42");
    expect(signed(-17)).toBe("−17");
    expect(signed(0)).toBe("0");
  });

  it("reads the organiser's summary and a participant's state", () => {
    const s = normalizeNpsSummary({ distribution: [0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1], comments: [{ score: 9, comment: "  Great  " }, { score: 3, comment: "" }] });
    expect(s.responses).toBe(4);
    expect(s.promoters).toBe(2);
    expect(s.detractors).toBe(1);
    expect(s.passives).toBe(1);
    expect(s.score).toBe(25);
    expect(s.comments).toEqual([{ score: 9, comment: "Great", at: null }]);
    expect(normalizeNpsSummary({ responses: 0, score: null }).score).toBeNull();
    const st = normalizeNpsState({ eligible: true, open: true, answer: { score: 8, comment: null } });
    expect(st).toMatchObject({ eligible: true, open: true, closed: false, answer: { score: 8, comment: null } });
    expect(normalizeNpsState({ eligible: true, open: false, answer: null }).answer).toBeNull();
  });
});

describe("the archive", () => {
  const now = Date.UTC(2026, 9, 19, 12);
  const ev = (o: Record<string, unknown>) => ({ id: 1, is_published: true, status: "upcoming", ...o });

  it("is 14 days after the end", () => {
    expect(ARCHIVE_AFTER_DAYS).toBe(14);
    expect(autoArchiveAt("2026-10-01T18:00:00Z")?.toISOString()).toBe("2026-10-15T18:00:00.000Z");
    expect(autoArchiveAt(null)).toBeNull();
  });

  it("knows where an event stands", () => {
    expect(archiveStateOf(ev({ archived_at: "2026-10-10T00:00:00Z" }), now).stage).toBe("archived");
    expect(archiveStateOf(ev({ status: "archived" }), now).stage).toBe("archived");
    expect(archiveStateOf(ev({ is_published: false, end_date: "2026-01-01" }), now).stage).toBe("draft");
    expect(archiveStateOf(ev({ end_date: null }), now).stage).toBe("no_end");
    expect(archiveStateOf(ev({ end_date: new Date(now + DAY).toISOString() }), now).stage).toBe("running");
    const waiting = archiveStateOf(ev({ end_date: new Date(now - 3 * DAY).toISOString() }), now);
    expect(waiting.stage).toBe("waiting");
    expect(waiting.autoAt).toBe(new Date(now + 11 * DAY).toISOString());
    expect(archiveStateOf(ev({ end_date: new Date(now - 15 * DAY).toISOString() }), now).stage).toBe("due");
    expect(isArchivedEvent({ status: " Archived " })).toBe(true);
    expect(isArchivedEvent({ status: "upcoming" })).toBe(false);
    expect(exportPath(7)).toBe("/api/events/7/export.zip");
  });
});

describe("the walkthrough", () => {
  it("answers the certificates, the plan, NPS and the builder, and nothing else", () => {
    const list = resolveWrapupDemo(["events", "1", "certificates"]) as unknown[];
    const certs = normalizeCertificates(list);
    expect(certs.length).toBeGreaterThan(20);
    expect(new Set(certs.map((c) => c.code)).size).toBe(certs.length);
    expect(certs.every((c) => isCodeShape(c.code))).toBe(true);
    expect(certs.some((c) => c.revokedAt)).toBe(true);
    expect(certs.some((c) => !c.emailedAt)).toBe(true);
    const plan = normalizePlan(resolveWrapupDemo(["events", "1", "certificates", "plan"]));
    expect(plan.needsResults).toBe(true);
    expect(plan.toIssue).toBeGreaterThan(0);
    const nps = normalizeNpsSummary(resolveWrapupDemo(["events", "1", "feedback", "nps"]));
    expect(nps.responses).toBe(nps.distribution.reduce((a, b) => a + b, 0));
    expect(nps.score).toBe(npsScore(nps.distribution.flatMap((n, i) => Array(n).fill(i))));
    expect((resolveWrapupDemo(["events", "1", "builder"]) as { event: { certificate_config: unknown } }).event.certificate_config).toBeTruthy();
    expect(resolveWrapupDemo(["events", "1", "feedback"])).toBeUndefined();
    expect(resolveWrapupDemo(["events", "1", "results"])).toBeUndefined();
    expect(resolveWrapupDemo(["teams"])).toBeUndefined();
  });
});
