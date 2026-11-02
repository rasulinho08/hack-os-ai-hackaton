import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { fetchPublicEvent } from "@/lib/builder/publicFetch";
import { formatInZone } from "@/lib/builder/datetime";

/*
 * The picture a shared event link shows: name, summary, dates and place on
 * the event's colour. Inter is embedded because the default font has no
 * Azerbaijani "ə" and no Cyrillic.
 */
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Event";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await fetchPublicEvent(slug).catch(() => null);
  const [semi, regular] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/fonts/Inter-SemiBold.ttf")),
    readFile(join(process.cwd(), "src/assets/fonts/Inter-Regular.ttf")),
  ]);
  const accent = event?.brand_color || "#E1003C";
  const lang = event?.language || "en";
  const when = event ? `${formatInZone(event.start_date, event.timezone, lang, { hour: undefined, minute: undefined })} – ${formatInZone(event.end_date, event.timezone, lang, { hour: undefined, minute: undefined })}` : "";
  const place = event ? (event.format === "online" ? "Online" : [event.venue_name, event.city].filter(Boolean).join(", ")) : "";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: `linear-gradient(135deg, #14181F 0%, #1C222C 60%, ${accent} 160%)`, color: "#FBFAF8", fontFamily: "Inter" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: accent }} />
          <div style={{ fontSize: 26, color: "rgba(251,250,248,0.75)" }}>{event?.organiser?.name || "HackOS"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: event && event.name.length > 40 ? 64 : 80, fontWeight: 600, lineHeight: 1.05, letterSpacing: -1.5 }}>{event?.name || "Event"}</div>
          {event?.tagline ? <div style={{ fontSize: 32, color: "rgba(251,250,248,0.8)", lineHeight: 1.3 }}>{event.tagline}</div> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 28 }}>
            <div>{when}</div>
            {place ? <div style={{ color: "rgba(251,250,248,0.7)" }}>{place}</div> : null}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "rgba(251,250,248,0.6)" }}>hack-os.app</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: semi, weight: 600, style: "normal" },
        { name: "Inter", data: regular, weight: 400, style: "normal" },
      ],
    },
  );
}
