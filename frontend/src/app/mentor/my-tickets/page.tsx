"use client";

import { MentorQueue } from "@/components/help/MentorQueue";

/** The same queue, opened on the requests the mentor took. */
export default function MentorMyTicketsPage() {
  return <MentorQueue initialTab="mine" />;
}
