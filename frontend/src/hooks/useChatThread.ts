"use client";

/**
 * One chat channel, live.
 *
 * Loads the newest page, then waits for news with a long poll
 * (`after=<last id>&wait=20&since=<server time>`): the API answers as soon as
 * something is written or removed, or after twenty seconds with nothing.
 * Errors back off from 2 to 30 seconds. A tab hidden for more than a minute
 * stops asking until it is shown again. Changing channel or leaving the
 * screen aborts the request in flight.
 *
 * What the person writes appears at once ("sending…"), and is replaced by the
 * server's copy, or marked as not sent with the reason and a way to send it
 * again. New messages from others are marked read while the tab is visible.
 * In the walkthrough (sample data) nothing changes, so nothing is polled or
 * marked read.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, DemoReadOnlyError, isDemoApiEnabled } from "@/lib/api";
import {
  WAIT_SECONDS, applyRemoved, chatApi, chatErrorKey, firstConfirmedId, lastConfirmedId, mergeMessages,
  type ChatMessage,
} from "@/lib/chat";

export type ThreadStatus = "loading" | "ready" | "failed" | "gone";

interface ThreadState {
  /** `${eventId}:${channelId}` — the channel this state belongs to. */
  key: string;
  messages: ChatMessage[];
  status: ThreadStatus;
  hasMore: boolean;
  loadingOlder: boolean;
}

export interface SendResult {
  ok: boolean;
  /** The "ch.err." key when it was not sent. */
  errorKey?: string;
  code?: string;
}

const HIDDEN_PAUSE_MS = 60_000;
const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;
const EMPTY: ThreadState = { key: "", messages: [], status: "loading", hasMore: false, loadingOlder: false };

export function useChatThread(
  eventId: number | null,
  channelId: number | null,
  opts: { onActivity?: () => void } = {},
) {
  const key = eventId != null && channelId != null ? `${eventId}:${channelId}` : "";
  const [state, setState] = useState<ThreadState>(EMPTY);
  const cursor = useRef({ lastId: 0, at: null as string | null, readSent: 0 });
  const tempSeq = useRef(0);
  const onActivity = useRef(opts.onActivity);

  useEffect(() => {
    onActivity.current = opts.onActivity;
  });

  useEffect(() => {
    if (eventId == null || channelId == null) return;
    const ctrl = new AbortController();
    const k = `${eventId}:${channelId}`;
    cursor.current = { lastId: 0, at: null, readSent: 0 };
    let hiddenSince: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    let wake: (() => void) | null = null;

    const markRead = () => {
      const c = cursor.current;
      // The walkthrough keeps nothing: a read mark would only be refused.
      if (isDemoApiEnabled() || document.visibilityState !== "visible" || c.lastId <= c.readSent) return;
      c.readSent = c.lastId;
      chatApi.markRead(eventId, channelId, c.lastId).then(
        () => onActivity.current?.(),
        () => { c.readSent = 0; },
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
        return;
      }
      hiddenSince = null;
      wake?.();
      markRead();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, ms);
      ctrl.signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
    });
    const untilVisible = () => new Promise<void>((resolve) => {
      wake = () => { wake = null; resolve(); };
      ctrl.signal.addEventListener("abort", () => resolve(), { once: true });
    });

    const run = async () => {
      let first;
      try {
        first = await chatApi.messages(eventId, channelId, {}, ctrl.signal);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const gone = err instanceof ApiError && (err.status === 404 || err.status === 403);
        setState({ ...EMPTY, key: k, status: gone ? "gone" : "failed" });
        return;
      }
      if (ctrl.signal.aborted) return;
      cursor.current.lastId = lastConfirmedId(first.messages);
      cursor.current.at = first.at;
      setState({ key: k, messages: first.messages, status: "ready", hasMore: first.hasMore, loadingOlder: false });
      markRead();
      // The walkthrough's sample answers never change.
      if (isDemoApiEnabled()) return;

      let backoff = BACKOFF_START_MS;
      while (!ctrl.signal.aborted) {
        if (hiddenSince != null && Date.now() - hiddenSince > HIDDEN_PAUSE_MS) {
          await untilVisible();
          if (ctrl.signal.aborted) break;
        }
        try {
          const page = await chatApi.messages(
            eventId, channelId,
            { after: cursor.current.lastId, since: cursor.current.at, wait: WAIT_SECONDS },
            ctrl.signal,
          );
          if (ctrl.signal.aborted) break;
          backoff = BACKOFF_START_MS;
          cursor.current.at = page.at ?? cursor.current.at;
          if (page.messages.length || page.removed.length) {
            cursor.current.lastId = Math.max(cursor.current.lastId, lastConfirmedId(page.messages));
            setState((s) => (s.key !== k ? s : { ...s, messages: applyRemoved(mergeMessages(s.messages, page.messages), page.removed) }));
            if (page.messages.some((m) => !m.mine)) markRead();
            onActivity.current?.();
          }
        } catch (err) {
          if (ctrl.signal.aborted) break;
          if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
            setState((s) => (s.key !== k ? s : { ...s, status: "gone" }));
            break;
          }
          await sleep(backoff);
          backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        }
      }
    };
    void run();

    return () => {
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [eventId, channelId]);

  /** Sends `body`, shown at once as "sending…". */
  const deliver = useCallback(async (body: string, tempId: number): Promise<SendResult> => {
    if (eventId == null || channelId == null) return { ok: false, errorKey: "ch.err.generic" };
    const k = `${eventId}:${channelId}`;
    try {
      const saved = await chatApi.post(eventId, channelId, body);
      setState((s) => (s.key !== k ? s : {
        ...s,
        messages: mergeMessages(s.messages.filter((m) => m.id !== tempId), saved ? [saved] : []),
      }));
      return { ok: true };
    } catch (err) {
      // The walkthrough says itself that nothing is sent; no "not sent" copy is left behind.
      if (err instanceof DemoReadOnlyError) {
        setState((s) => (s.key !== k ? s : { ...s, messages: s.messages.filter((m) => m.id !== tempId) }));
        return { ok: false, errorKey: "ch.err.generic" };
      }
      const errorKey = chatErrorKey(err);
      setState((s) => (s.key !== k ? s : {
        ...s,
        messages: s.messages.map((m) => (m.id === tempId ? { ...m, pending: false, failed: errorKey } : m)),
      }));
      return { ok: false, errorKey, code: err instanceof ApiError ? err.code : undefined };
    }
  }, [eventId, channelId]);

  const send = useCallback(async (body: string): Promise<SendResult> => {
    if (eventId == null || channelId == null) return { ok: false, errorKey: "ch.err.generic" };
    const k = `${eventId}:${channelId}`;
    tempSeq.current += 1;
    const tempId = -tempSeq.current;
    const draft: ChatMessage = {
      id: tempId, channelId, author: null, body, removed: false,
      createdAt: new Date().toISOString(), mine: true, pending: true, failed: null,
    };
    setState((s) => (s.key !== k ? s : { ...s, messages: mergeMessages(s.messages, [draft]) }));
    return deliver(body, tempId);
  }, [eventId, channelId, deliver]);

  /** Sends a message that did not go out again. */
  const retry = useCallback(async (tempId: number): Promise<SendResult> => {
    const m = state.messages.find((x) => x.id === tempId && x.failed);
    if (!m || m.body == null) return { ok: false, errorKey: "ch.err.generic" };
    const body = m.body;
    setState((s) => ({ ...s, messages: s.messages.map((x) => (x.id === tempId ? { ...x, pending: true, failed: null } : x)) }));
    return deliver(body, tempId);
  }, [state.messages, deliver]);

  /** Drops a message that did not go out. */
  const discard = useCallback((tempId: number) => {
    setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== tempId) }));
  }, []);

  /** The page before the oldest message on screen. */
  const loadOlder = useCallback(async () => {
    if (eventId == null || channelId == null) return;
    const k = `${eventId}:${channelId}`;
    const before = firstConfirmedId(state.messages);
    if (before == null) return;
    setState((s) => (s.key !== k ? s : { ...s, loadingOlder: true }));
    try {
      const page = await chatApi.messages(eventId, channelId, { before });
      setState((s) => (s.key !== k ? s : { ...s, messages: mergeMessages(s.messages, page.messages), hasMore: page.hasMore, loadingOlder: false }));
    } catch {
      setState((s) => (s.key !== k ? s : { ...s, loadingOlder: false }));
      throw new Error("older page failed");
    }
  }, [eventId, channelId, state.messages]);

  /** After a successful removal: the words go at once, before the long poll says so. */
  const markRemoved = useCallback((messageId: number) => {
    setState((s) => ({ ...s, messages: applyRemoved(s.messages, [messageId]) }));
  }, []);

  const current = state.key === key ? state : null;
  return {
    messages: current?.messages ?? [],
    status: (current?.status ?? "loading") as ThreadStatus,
    hasMore: current?.hasMore ?? false,
    loadingOlder: current?.loadingOlder ?? false,
    send,
    retry,
    discard,
    loadOlder,
    markRemoved,
  };
}
