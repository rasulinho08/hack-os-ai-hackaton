"use client";

/** The judge's chat: the general channel (unless judging is blind) and their thread with the organisers. */

import { ChatPage } from "@/components/chat/ChatPage";
import { resolveJudgeEventIds } from "@/lib/resolveEventId";
import { myEventsAs } from "@/lib/workspaces";

/** The event this person judges in: the one they entered, else the first of theirs (as the scoring page picks). */
async function judgeEventId(): Promise<number | null> {
  try {
    const mine = await myEventsAs("judge");
    if (mine.length) return mine[0].id;
  } catch {
    /* fall back below */
  }
  const ids = await resolveJudgeEventIds().catch(() => [] as number[]);
  return ids[0] ?? null;
}

export default function JudgeChatPage() {
  return <ChatPage portal="judge" resolveEventId={judgeEventId} />;
}
