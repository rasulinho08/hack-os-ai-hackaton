"use client";

/** The mentor's chat: the general channel, their thread with the organisers, and the help requests they took. */

import { ChatPage } from "@/components/chat/ChatPage";
import { staffEventId } from "@/lib/participantEvent";

const mentorEventId = () => staffEventId("mentor");

export default function MentorChatPage() {
  return <ChatPage portal="mentor" resolveEventId={mentorEventId} />;
}
