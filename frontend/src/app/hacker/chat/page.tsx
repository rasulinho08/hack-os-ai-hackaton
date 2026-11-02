"use client";

/** The participant's chat: the event's general channel, their team, and their thread with the organisers. */

import { ChatPage } from "@/components/chat/ChatPage";
import { participantEventId } from "@/lib/participantEvent";

export default function HackerChatPage() {
  return <ChatPage portal="participant" resolveEventId={participantEventId} />;
}
