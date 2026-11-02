/**
 * The event chat's pure parts: reading the API's answers, merging what a long
 * poll brings into what is on screen (no duplicates, removals stick, a message
 * on its way replaced by the server's copy), links in plain text, the day
 * lines and runs, the channel order, the error words — and the walkthrough's
 * sample chat, which must read like the real API.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import {
  applyRemoved, channelTitleKey, chatApi, chatErrorKey, dayKey, firstConfirmedId, groupByDay, initials,
  lastConfirmedId, linkify, mergeMessages, muteKey, normalizeChannel, normalizeList, normalizeMessage,
  normalizeMutes, normalizePage, normalizeReports, sortChannels, startsRun,
  type ChannelSummary, type ChatMessage,
} from "@/lib/chat";
import { resolveChatDemo } from "@/lib/demo/chat";
import { resolveDemoRead } from "@/lib/demo/resolve";
import { DEMO_TICKETS } from "@/lib/demo/console";

const msg = (id: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channelId: 7,
  author: { id: 50, name: "Aysel Məmmədova", role: "participant", avatar: null },
  body: `message ${id}`,
  removed: false,
  createdAt: "2026-10-19T10:00:00.000Z",
  mine: false,
  ...over,
});

const channel = (over: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id: 1, kind: "general", teamId: null, teamName: null, userId: null, personName: null,
  ticketId: null, ticketTopic: null, ticketStatus: null, locked: false, canPost: true, canModerate: false,
  unread: 0, lastReadId: 0, lastMessage: null, ...over,
});

describe("reading the API's answers", () => {
  it("keeps what a channel list says and drops what it cannot use", () => {
    const list = normalizeList({
      enabled: { general: true, team: 1, support: false },
      me: { userId: "12", organizer: false, muted: true, mutedUntil: "2026-10-19T12:00:00.000Z" },
      openReports: null,
      channels: [
        { id: 3, kind: "team", teamId: 9, teamName: "Byte Club", locked: true, canPost: false, unread: -4, lastMessage: { id: 40, preview: "hi", at: "2026-10-19T09:00:00.000Z", authorName: "Elvin" } },
        { kind: "general" },
        { id: 4, kind: "weird", lastMessage: { preview: "no id" } },
        null,
      ],
    });
    expect(list.enabled).toEqual({ general: true, team: true, support: false, ticket: false });
    expect(list.me).toEqual({ userId: 12, organizer: false, muted: true, mutedUntil: "2026-10-19T12:00:00.000Z" });
    expect(list.openReports).toBeNull();
    expect(list.channels.map((c) => c.id)).toEqual([3, 4]);
    expect(list.channels[0]).toMatchObject({ kind: "team", teamName: "Byte Club", locked: true, canPost: false, unread: 0 });
    expect(list.channels[0].lastMessage).toEqual({ id: 40, preview: "hi", at: "2026-10-19T09:00:00.000Z", authorName: "Elvin" });
    // An unknown kind reads as the general channel; a last message without an id is none.
    expect(list.channels[1]).toMatchObject({ kind: "general", lastMessage: null });
    expect(normalizeChannel({ id: "x" })).toBeNull();
    expect(normalizeList(undefined)).toMatchObject({ channels: [], openReports: null, me: { userId: null, organizer: false } });
  });

  it("shows no words for a removed message and a participant for an unknown role", () => {
    expect(normalizeMessage({ id: 5, channelId: 2, body: "secret", removed: true, author: { id: 1, name: "A", role: "organizer" } }))
      .toMatchObject({ id: 5, body: null, removed: true, author: { role: "organizer" } });
    expect(normalizeMessage({ id: 6, author: { id: 2, role: "superadmin" }, body: "hi", mine: 1 }))
      .toMatchObject({ author: { id: 2, name: null, role: "participant", avatar: null }, mine: true });
    expect(normalizeMessage({ id: 7, author: { name: "no id" } })?.author).toBeNull();
    expect(normalizeMessage({ body: "no id" })).toBeNull();
  });

  it("reads a page with its removals and the server's clock", () => {
    const page = normalizePage({ channelId: 2, messages: [{ id: 1, body: "a" }, { body: "b" }], removed: [3, "4", "x"], at: "2026-10-19T10:00:00.000Z", hasMore: true });
    expect(page.messages.map((m) => m.id)).toEqual([1]);
    expect(page.removed).toEqual([3, 4]);
    expect(page).toMatchObject({ channelId: 2, at: "2026-10-19T10:00:00.000Z", hasMore: true });
    expect(normalizePage(null)).toEqual({ channelId: 0, messages: [], removed: [], at: null, hasMore: false });
  });

  it("reads reports and mutes, dropping rows without an id", () => {
    const reports = normalizeReports([
      { messageId: 9, channelId: 1, channelKind: "team", teamName: "Byte Club", body: "spam", author: { id: 3, name: "Nicat" }, reports: 2, reasons: ["Spam", null, ""] },
      { channelId: 1 },
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ messageId: 9, channelKind: "team", reports: 2, reasons: ["Spam"], author: { id: 3, name: "Nicat" } });
    const mutes = normalizeMutes([{ userId: 4, name: "Leyla", until: null, reason: "", mutedBy: "Demo Organiser" }, { name: "nobody" }]);
    expect(mutes).toEqual([{ userId: 4, name: "Leyla", until: null, reason: null, since: null, mutedBy: "Demo Organiser" }]);
  });
});

describe("merging messages", () => {
  it("keeps one copy of each message, in order", () => {
    const merged = mergeMessages([msg(1), msg(3)], [msg(3, { body: "edited" }), msg(2)]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(merged[2].body).toBe("edited");
    const same = [msg(1)];
    expect(mergeMessages(same, [])).toBe(same);
  });

  it("never brings back the words of a removed message", () => {
    const removed = msg(4, { removed: true, body: null });
    expect(mergeMessages([removed], [msg(4)])[0]).toMatchObject({ removed: true, body: null });
    expect(mergeMessages([msg(4)], [removed])[0]).toMatchObject({ removed: true, body: null });
  });

  it("replaces a message on its way with the server's copy of it", () => {
    const draft = msg(-1, { body: "hello", mine: true, pending: true, author: null });
    const shown = mergeMessages([msg(1)], [draft]);
    // A fresh draft is not mistaken for its own confirmation.
    expect(shown.map((m) => m.id)).toEqual([1, -1]);
    const confirmed = mergeMessages(shown, [msg(2, { body: "hello", mine: true })]);
    expect(confirmed.map((m) => m.id)).toEqual([1, 2]);
  });

  it("replaces one draft per confirmed copy, and keeps the ones that failed", () => {
    const a = msg(-1, { body: "ok", mine: true, pending: true });
    const b = msg(-2, { body: "ok", mine: true, pending: true });
    const failed = msg(-3, { body: "ok", mine: true, pending: false, failed: "ch.err.CHAT_MUTED" });
    const out = mergeMessages([a, b, failed], [msg(10, { body: "ok", mine: true })]);
    expect(out.map((m) => m.id)).toEqual([10, -2, -3]);
    // Someone else's message with the same words is not mine.
    expect(mergeMessages([a], [msg(11, { body: "ok", mine: false })]).map((m) => m.id)).toEqual([11, -1]);
  });

  it("orders drafts after the confirmed messages, oldest draft first", () => {
    const out = mergeMessages([], [msg(-2, { pending: true, mine: true, body: "second" }), msg(5), msg(-1, { pending: true, mine: true, body: "first" })]);
    expect(out.map((m) => m.id)).toEqual([5, -1, -2]);
  });

  it("marks removals and knows the newest and oldest confirmed ids", () => {
    const list = [msg(1), msg(2), msg(-1, { pending: true })];
    const out = applyRemoved(list, [2, 99]);
    expect(out[1]).toMatchObject({ removed: true, body: null });
    expect(out[0]).toBe(list[0]);
    expect(applyRemoved(list, [])).toBe(list);
    expect(applyRemoved(out, [2])).toBe(out);
    expect(lastConfirmedId(list)).toBe(2);
    expect(firstConfirmedId(list)).toBe(1);
    expect(lastConfirmedId([])).toBe(0);
    expect(firstConfirmedId([msg(-1)])).toBeNull();
  });
});

describe("links in plain text", () => {
  const links = (text: string) => linkify(text).filter((p) => p.type === "link").map((p) => p.value);

  it("finds http and https addresses and keeps the rest as text", () => {
    const parts = linkify("Slides: https://example.com/deck and http://test.az/x?a=1#b done");
    expect(parts.map((p) => p.type)).toEqual(["text", "link", "text", "link", "text"]);
    expect(links("Slides: https://example.com/deck and http://test.az/x?a=1#b done")).toEqual(["https://example.com/deck", "http://test.az/x?a=1#b"]);
    expect(parts.map((p) => p.value).join("")).toBe("Slides: https://example.com/deck and http://test.az/x?a=1#b done");
  });

  it("leaves sentence punctuation and an unbalanced bracket out of the address", () => {
    expect(links("See https://example.com/a.")).toEqual(["https://example.com/a"]);
    expect(links("(https://example.com/b), then")).toEqual(["https://example.com/b"]);
    expect(links("https://en.wikipedia.org/wiki/Baku_(city)!")).toEqual(["https://en.wikipedia.org/wiki/Baku_(city)"]);
    expect(links("«https://example.com/c»")).toEqual(["https://example.com/c"]);
  });

  it("never links anything but a web address", () => {
    expect(links("javascript:alert(1) data:text/html,x ftp://x.az <b>https://</b>")).toEqual([]);
    expect(linkify("<script>alert(1)</script>")).toEqual([{ type: "text", value: "<script>alert(1)</script>" }]);
    expect(linkify("")).toEqual([{ type: "text", value: "" }]);
  });
});

describe("days and runs", () => {
  it("puts messages in runs of one day, drafts with the last day", () => {
    const groups = groupByDay([
      msg(1, { createdAt: "2026-10-18T09:00:00" }),
      msg(2, { createdAt: "2026-10-18T09:05:00" }),
      msg(3, { createdAt: "2026-10-19T09:00:00" }),
      msg(-1, { createdAt: "2026-10-20T09:00:00", pending: true }),
    ]);
    expect(groups.map((g) => [g.day, g.messages.map((m) => m.id)])).toEqual([
      ["2026-10-18", [1, 2]],
      ["2026-10-19", [3, -1]],
    ]);
    expect(dayKey(null)).toBe("");
    expect(dayKey("not a date")).toBe("");
  });

  it("starts a run on another author, on mine, or after five minutes", () => {
    const a = msg(1, { createdAt: "2026-10-19T10:00:00.000Z" });
    expect(startsRun(undefined, a)).toBe(true);
    expect(startsRun(a, msg(2, { createdAt: "2026-10-19T10:04:00.000Z" }))).toBe(false);
    expect(startsRun(a, msg(2, { createdAt: "2026-10-19T10:06:00.000Z" }))).toBe(true);
    expect(startsRun(a, msg(2, { author: { id: 51, name: "B", role: "mentor", avatar: null } }))).toBe(true);
    expect(startsRun(a, msg(2, { mine: true }))).toBe(true);
  });

  it("makes initials from a name", () => {
    expect(initials("Aysel Məmmədova")).toBe("AM");
    expect(initials("  nicat ")).toBe("N");
    expect(initials("Elvin Ramiz Şirinov")).toBe("EŞ");
    expect(initials(null)).toBe("?");
  });
});

describe("channels", () => {
  it("names a thread with the organisers by its person for the organisers only", () => {
    const support = channel({ kind: "support", personName: "Leyla" });
    expect(channelTitleKey(support, true)).toEqual({ key: "ch.kind.support_person", name: "Leyla" });
    expect(channelTitleKey(support, false)).toEqual({ key: "ch.kind.support", name: null });
    expect(channelTitleKey(channel({ kind: "team", teamName: "Byte Club" }), false)).toEqual({ key: "ch.kind.team", name: "Byte Club" });
    expect(channelTitleKey(channel({ kind: "ticket", ticketTopic: "Docker" }), true)).toEqual({ key: "ch.kind.ticket", name: "Docker" });
    expect(channelTitleKey(channel(), true)).toEqual({ key: "ch.kind.general", name: null });
  });

  it("lists the general channel, the team, the organisers, then help requests, the latest first", () => {
    const last = (at: string) => ({ id: 1, preview: "x", at, authorName: null });
    const sorted = sortChannels([
      channel({ id: 5, kind: "ticket", lastMessage: last("2026-10-19T08:00:00.000Z") }),
      channel({ id: 6, kind: "ticket", lastMessage: last("2026-10-19T09:00:00.000Z") }),
      channel({ id: 2, kind: "support" }),
      channel({ id: 3, kind: "team" }),
      channel({ id: 1, kind: "general" }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual([1, 3, 2, 6, 5]);
  });
});

describe("errors", () => {
  it("has words for the API's chat codes, too many requests and a missing message", () => {
    expect(chatErrorKey(new ApiError("muted", 403, [], "CHAT_MUTED"))).toBe("ch.err.CHAT_MUTED");
    expect(chatErrorKey(new ApiError("slow down", 429))).toBe("ch.err.RATE_LIMITED");
    expect(chatErrorKey(new ApiError("gone", 404, [], "SOMETHING_ELSE"))).toBe("ch.err.NOT_FOUND");
    expect(chatErrorKey(new ApiError("boom", 500))).toBe("ch.err.generic");
    expect(chatErrorKey(new Error("offline"))).toBe("ch.err.generic");
    expect(muteKey(60)).toBe("ch.mute.60");
    expect(muteKey(null)).toBe("ch.mute.forever");
  });
});

describe("talking to the API", () => {
  afterEach(() => vi.unstubAllGlobals());

  function backend(data: unknown) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void url; void init;
      return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("asks for news after the last message, with the server's clock, and can be stopped", async () => {
    const fetchMock = backend({ channelId: 4, messages: [], removed: [], at: "2026-10-19T10:00:00.000Z", hasMore: false });
    const ctrl = new AbortController();
    const page = await chatApi.messages(1, 4, { after: 12, since: "2026-10-19T09:59:40.000Z", wait: 20 }, ctrl.signal);
    expect(page.at).toBe("2026-10-19T10:00:00.000Z");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/events/1/chat/channels/4/messages?after=12&since=2026-10-19T09%3A59%3A40.000Z&wait=20");
    expect(init?.signal).toBe(ctrl.signal);
    await chatApi.messages(1, 4);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/events/1/chat/channels/4/messages");
    await chatApi.messages(1, 4, { before: 30 });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/events/1/chat/channels/4/messages?before=30");
  });

  it("sends a message, a read mark, a lock and a mute to their addresses", async () => {
    const fetchMock = backend({ id: 77, channelId: 4, body: "hi", mine: true });
    expect(await chatApi.post(1, 4, "hi")).toMatchObject({ id: 77, mine: true });
    await chatApi.markRead(1, 4, 77);
    await chatApi.lock(1, 4, true);
    await chatApi.lock(1, 4, false);
    await chatApi.mute(1, { userId: 9, minutes: null, reason: "" });
    await chatApi.resolve(1, 77, "dismiss");
    const calls = fetchMock.mock.calls.map(([url, init]) => [init?.method, url, init?.body]);
    expect(calls).toEqual([
      ["POST", "/api/events/1/chat/channels/4/messages", JSON.stringify({ body: "hi" })],
      ["POST", "/api/events/1/chat/channels/4/read", JSON.stringify({ lastId: 77 })],
      ["POST", "/api/events/1/chat/channels/4/lock", "{}"],
      ["POST", "/api/events/1/chat/channels/4/unlock", "{}"],
      ["POST", "/api/events/1/chat/mutes", JSON.stringify({ userId: 9, minutes: null })],
      ["POST", "/api/events/1/chat/reports/77/resolve", JSON.stringify({ action: "dismiss" })],
    ]);
  });
});

describe("the walkthrough's chat", () => {
  const list = normalizeList(resolveDemoRead("/api/events/1/chat"));

  it("shows the organiser every kind of channel, with unread messages and a report", () => {
    expect(list.me).toMatchObject({ userId: 1, organizer: true, muted: false });
    expect(new Set(list.channels.map((c) => c.kind))).toEqual(new Set(["general", "team", "support", "ticket"]));
    expect(sortChannels(list.channels)[0].kind).toBe("general");
    expect(list.channels.every((c) => c.canPost && c.canModerate && c.lastMessage)).toBe(true);
    expect(list.channels.reduce((n, c) => n + c.unread, 0)).toBeGreaterThan(0);
    expect(list.openReports).toBe(1);
    expect(new Set(list.channels.map((c) => c.id)).size).toBe(list.channels.length);
  });

  it("answers every channel's messages, in order, the organiser's own marked as theirs", () => {
    for (const c of list.channels) {
      const page = normalizePage(resolveDemoRead(`/api/events/1/chat/channels/${c.id}/messages`));
      expect(page.channelId).toBe(c.id);
      expect(page.messages.length).toBeGreaterThan(0);
      const ids = page.messages.map((m) => m.id);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
      expect(c.lastMessage?.id).toBe(ids.at(-1));
      // The unread count is the backend's: others' messages after the read mark.
      expect(page.messages.filter((m) => m.id > c.lastReadId && !m.mine && !m.removed).length).toBe(c.unread);
      for (const m of page.messages) expect(m.mine).toBe(m.author?.id === 1);
    }
    const general = normalizePage(resolveDemoRead(`/api/events/1/chat/channels/${list.channels[0].id}/messages`));
    expect(general.messages.some((m) => m.removed && m.body == null)).toBe(true);
  });

  it("reports a message that is in its channel, and lists who is muted", () => {
    const reports = normalizeReports(resolveDemoRead("/api/events/1/chat/reports"));
    expect(reports).toHaveLength(1);
    const page = normalizePage(resolveDemoRead(`/api/events/1/chat/channels/${reports[0].channelId}/messages`));
    expect(page.messages.find((m) => m.id === reports[0].messageId)?.body).toBe(reports[0].body);
    const mutes = normalizeMutes(resolveDemoRead("/api/events/1/chat/mutes"));
    expect(mutes.length).toBe(2);
    expect(mutes.some((m) => m.until == null)).toBe(true);
    expect(mutes.some((m) => m.until != null && Date.parse(m.until) > Date.now())).toBe(true);
  });

  it("opens a thread for every help request of the sample queue", () => {
    const ids = new Set<number>();
    for (const ticket of DEMO_TICKETS) {
      const c = normalizeChannel(resolveDemoRead(`/api/events/1/chat/tickets/${ticket.id}`));
      expect(c).toMatchObject({ kind: "ticket", ticketId: ticket.id, ticketTopic: ticket.topic });
      const id = c?.id ?? -1;
      ids.add(id);
      expect(normalizePage(resolveDemoRead(`/api/events/1/chat/channels/${id}/messages`)).channelId).toBe(id);
    }
    expect(ids.size).toBe(DEMO_TICKETS.length);
  });

  it("leaves other paths alone", () => {
    expect(resolveChatDemo(["events", "1", "chat", "channels", "999999", "messages"])).toBeUndefined();
    expect(resolveChatDemo(["events", "1", "chat", "tickets", "1"])).toBeUndefined();
    expect(resolveChatDemo(["events", "1", "chat", "nothing"])).toBeUndefined();
    expect(resolveChatDemo(["events", "1", "participants"])).toBeUndefined();
    expect(resolveChatDemo(["me", "notifications"])).toBeUndefined();
  });
});
