/**
 * Invitations: what the organiser pastes or uploads becomes a checked,
 * de-duplicated list; the API's answers are read defensively; and the rules
 * the screen shows (what can be done with an invitation, what a bulk action
 * acts on, why addresses were skipped).
 */
import { describe, expect, it } from "vitest";
import {
  actionsFor, bulkTargets, checkInvitees, normalizeInvitationsPage, normalizeSendResult, parseInviteCsv, parsePasted, skipCounts,
  type Invitation,
} from "@/lib/participantInvites";
import { isPublicApiRoute } from "@/lib/backendAuth";

describe("a pasted list", () => {
  it("splits on lines, commas, semicolons and spaces, and keeps names written as Name <address>", () => {
    const p = parsePasted("Aysel@Example.com, murad@example.com;  \n\"Leyla Həsənova\" <LEYLA@example.az>\nmailto:nigar@example.com bad@ aysel@example.com");
    expect(p.valid).toEqual([
      { email: "leyla@example.az", fullName: "Leyla Həsənova", team: null },
      { email: "aysel@example.com", fullName: null, team: null },
      { email: "murad@example.com", fullName: null, team: null },
      { email: "nigar@example.com", fullName: null, team: null },
    ]);
    expect(p.duplicates).toEqual(["aysel@example.com"]);
    expect(p.invalid).toEqual(["bad@"]);
  });

  it("is empty for empty input, and refuses names with markup", () => {
    expect(parsePasted("   \n ,, ")).toEqual({ valid: [], invalid: [], duplicates: [] });
    expect(checkInvitees([{ email: "x@example.com", fullName: "<b>x</b>" }]).invalid).toEqual(["x@example.com"]);
  });
});

describe("a CSV list", () => {
  it("finds the name, e-mail and team columns in English, Azerbaijani and Russian, with either separator", () => {
    const enCsv = parseInviteCsv("Name,E-mail,Team\r\nAysel,aysel@example.com,Owls\r\nMurad,MURAD@example.com,\r\n,aysel@example.com,Owls\r\n");
    expect(enCsv.valid).toEqual([
      { email: "aysel@example.com", fullName: "Aysel", team: "Owls" },
      { email: "murad@example.com", fullName: "Murad", team: null },
    ]);
    expect(enCsv.duplicates).toEqual(["aysel@example.com"]);
    expect(enCsv.columns).toEqual({ name: true, team: true });
    const azCsv = parseInviteCsv("Ad Soyad;E-poçt;Komanda\nLeyla;leyla@example.az;Bayquşlar\n");
    expect(azCsv.valid).toEqual([{ email: "leyla@example.az", fullName: "Leyla", team: "Bayquşlar" }]);
    const ruCsv = parseInviteCsv("﻿Имя,Почта\n\"Иванов, Пётр\",petr@example.ru\n");
    expect(ruCsv.valid).toEqual([{ email: "petr@example.ru", fullName: "Иванов, Пётр", team: null }]);
    expect(ruCsv.columns.team).toBe(false);
  });

  it("without a header naming the e-mail, takes the cells that look like addresses", () => {
    const p = parseInviteCsv("Aysel,aysel@example.com,Owls\nnot a person\n");
    expect(p.valid).toEqual([{ email: "aysel@example.com", fullName: "Aysel", team: "Owls" }]);
    expect(p.invalid).toEqual(["not a person"]);
  });
});

describe("the API's answers", () => {
  const raw = {
    event: { id: 7, name: "Hack", slug: "hack", visibility: "invite", published: true, archived: false, language: "ru" },
    items: [
      { id: 1, email: "A@x.com", status: "opened", sendCount: 2, sentAt: "2026-10-01T10:00:00Z" },
      { id: 2, email: "b@x.com", status: "registered", participantStatus: "approved" },
      { id: "x", email: "c@x.com", status: "sent" },
      { id: 3, email: "c@x.com", status: "weird" },
    ],
    capacity: { limit: 50, taken: 48, outstanding: 4, remaining: 2, overBy: 2 },
  };

  it("reads the list, counts by status and the places", () => {
    const p = normalizeInvitationsPage(raw);
    expect(p.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(p.items[0].email).toBe("a@x.com");
    expect(p.items[2].status).toBe("not_sent");
    expect(p.counts).toMatchObject({ opened: 1, registered: 1, not_sent: 1, total: 3 });
    expect(p.capacity).toEqual({ limit: 50, taken: 48, outstanding: 4, remaining: 2, overBy: 2 });
    expect(p.event.visibility).toBe("invite");
    expect(normalizeInvitationsPage(null).items).toEqual([]);
  });

  it("reads a send's result and words the skipped by reason", () => {
    const r = normalizeSendResult({ created: [1, 2], reinvited: [3], sent: 3, failed: 0, skipped: [{ email: "a", reason: "registered" }, { email: "b", reason: "registered" }, { reason: "mystery" }], duplicates: 1 });
    expect(r.created).toEqual([1, 2]);
    expect(skipCounts(r.skipped)).toEqual([{ reason: "registered", n: 2 }, { reason: "other_role", n: 1 }]);
  });
});

describe("what can be done with an invitation", () => {
  const inv = (id: number, status: Invitation["status"]) => ({ id, status }) as Invitation;

  it("open ones are copied, resent and withdrawn; expired ones resent or withdrawn; others nothing", () => {
    expect(actionsFor(inv(1, "sent"))).toEqual({ resend: true, revoke: true, copy: true });
    expect(actionsFor(inv(1, "expired"))).toEqual({ resend: true, revoke: true, copy: false });
    expect(actionsFor(inv(1, "registered"))).toEqual({ resend: false, revoke: false, copy: false });
    expect(actionsFor(inv(1, "revoked"))).toEqual({ resend: false, revoke: false, copy: false });
  });

  it("a bulk action acts on the ones it applies to and says how many it left out", () => {
    const items = [inv(1, "sent"), inv(2, "registered"), inv(3, "expired"), inv(4, "revoked")];
    expect(bulkTargets(items, ["1", "2", "3", "4"], "resend")).toEqual({ ids: [1, 3], skipped: 2 });
    expect(bulkTargets(items, [2], "revoke")).toEqual({ ids: [], skipped: 1 });
  });

  it("the registration page may read an invitation's link without a session, and nothing else under it", () => {
    expect(isPublicApiRoute("/api/public/invitations/m.12.abcdefghijklmnopqrstuvwxyzABCDEF", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/invitations/l.12.abcdefghijklmnopqrstuvwxyzABCDEF", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/invitations/x.12.abcdefghijklmnopqrstuvwxyzABCDEF", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/public/invitations/m.12.abc", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/public/invitations/m.12.abcdefghijklmnopqrstuvwxyzABCDEF", "POST")).toBe(false);
    expect(isPublicApiRoute("/api/events/1/participant-invites", "GET")).toBe(false);
  });
});
