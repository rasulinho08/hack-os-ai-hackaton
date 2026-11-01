import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchPublicEvent } from "@/lib/builder/publicFetch";
import { JoinCodeNotFound } from "./JoinCodeNotFound";

type Params = { params: Promise<{ eventCode: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Join event", robots: { index: false } };

/**
 * The code people type or were sent (/join/HBTN2026, team invites as
 * /join/HBTN2026?teamCode=…) leads to the event's own registration page,
 * where its organiser's questions and rules are.
 */
export default async function JoinPage({ params, searchParams }: Params) {
  const { eventCode } = await params;
  const sp = await searchParams;
  const code = decodeURIComponent(eventCode || "").trim();
  const event = code ? await fetchPublicEvent(code) : null;
  if (!event) return <JoinCodeNotFound code={code} />;

  const q = new URLSearchParams();
  const team = String((typeof sp.teamCode === "string" ? sp.teamCode : typeof sp.team === "string" ? sp.team : "") || "").trim();
  if (/^[A-Za-z0-9]{4,20}$/.test(team)) q.set("team", team);
  if (typeof sp.ref === "string" && sp.ref.trim()) q.set("ref", sp.ref.trim().slice(0, 40));
  const qs = q.toString();
  redirect(`/e/${encodeURIComponent(event.slug)}/register${qs ? `?${qs}` : ""}`);
}
