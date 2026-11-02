"use client";

/** The volunteer's chat: the general channel and their thread with the organisers. */

import { ChatPage } from "@/components/chat/ChatPage";
import { staffEventId } from "@/lib/participantEvent";

const volunteerEventId = () => staffEventId("volunteer");

export default function VolunteerChatPage() {
  return <ChatPage portal="volunteer" resolveEventId={volunteerEventId} />;
}
