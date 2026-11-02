"use client";

/**
 * Editing an event is the builder: the same twenty sections that created it.
 * This address stays for links and bookmarks and sends the organiser to the
 * builder of the event they are working in.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandLoader } from "@/components/BrandLoader";
import { useActiveEvent } from "@/contexts/ActiveEventContext";

export default function EditEventPage() {
  const router = useRouter();
  const { activeEventId, loading } = useActiveEvent();

  useEffect(() => {
    if (loading) return;
    router.replace(activeEventId ? `/create-event/${activeEventId}` : "/create-event");
  }, [activeEventId, loading, router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <BrandLoader />
    </div>
  );
}
