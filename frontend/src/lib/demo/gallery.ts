/**
 * Walkthrough answer for the photo gallery: GET /api/events/:id/gallery.
 * `s` is the path without "api"; anything else returns undefined.
 *
 * The photos are drawn here (SVG, as data: addresses the page's CSP allows)
 * rather than shipped as files: they stand for a weekend's pictures without
 * showing anyone real. The first two days are up and posted in the chat;
 * nobody has been e-mailed yet.
 */

import { DEMO_EVENT } from "./console";

/** Park–Miller, as in ./wrapup: the same picture on every visit. */
function random(seed: number) {
  let x = (seed * 7919) % 2147483647 || 1;
  return () => {
    x = (x * 48271) % 2147483647;
    return x / 2147483647;
  };
}

/** A room with people in it, in two colours and a light. */
function scene(seed: number, from: string, to: string, light: string): string {
  const r = random(seed);
  const people: string[] = [];
  const count = 5 + Math.floor(r() * 6);
  for (let i = 0; i < count; i += 1) {
    const x = 120 + r() * 1360;
    const scale = 0.7 + r() * 0.6;
    const y = 760 + r() * 260;
    const shade = `rgba(12,14,20,${(0.55 + r() * 0.3).toFixed(2)})`;
    people.push(
      `<circle cx="${x.toFixed(0)}" cy="${(y - 170 * scale).toFixed(0)}" r="${(46 * scale).toFixed(0)}" fill="${shade}"/>` +
        `<rect x="${(x - 70 * scale).toFixed(0)}" y="${(y - 120 * scale).toFixed(0)}" width="${(140 * scale).toFixed(0)}" height="${(260 * scale).toFixed(0)}" rx="${(60 * scale).toFixed(0)}" fill="${shade}"/>`,
    );
  }
  const screenX = 260 + r() * 700;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>` +
    `<radialGradient id="l" cx="0.5" cy="0.3" r="0.6"><stop offset="0" stop-color="${light}" stop-opacity="0.55"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="1600" height="1200" fill="url(#g)"/>` +
    `<rect x="${screenX.toFixed(0)}" y="170" width="${(380 + r() * 200).toFixed(0)}" height="240" rx="14" fill="rgba(255,255,255,0.16)"/>` +
    `<rect width="1600" height="1200" fill="url(#l)"/>` +
    `<rect y="1010" width="1600" height="190" fill="rgba(10,12,18,0.35)"/>` +
    people.join("") +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PHOTOS: { caption: string | null; colours: [string, string, string]; at: string }[] = [
  { caption: "Opening on Friday morning", colours: ["#1B2A4A", "#E1003C", "#FFD27A"], at: "2026-08-28T09:40:00.000Z" },
  { caption: "Team Nova sketching the first idea", colours: ["#20314F", "#3E7BFA", "#FFFFFF"], at: "2026-08-28T12:10:00.000Z" },
  { caption: "Mentor hours in room B", colours: ["#2B2238", "#8A5CF6", "#FDE68A"], at: "2026-08-28T16:30:00.000Z" },
  { caption: "Late night in the main hall", colours: ["#0E1424", "#1F3B73", "#7DD3FC"], at: "2026-08-28T23:20:00.000Z" },
  { caption: "Lunch on day two", colours: ["#3A2A1E", "#F59E0B", "#FFF7ED"], at: "2026-08-29T13:05:00.000Z" },
  { caption: null, colours: ["#13302B", "#10B981", "#ECFEFF"], at: "2026-08-29T17:45:00.000Z" },
  { caption: "Pitch rehearsal", colours: ["#2A1630", "#E1003C", "#FBCFE8"], at: "2026-08-30T10:15:00.000Z" },
  { caption: "The judges' table", colours: ["#1E2533", "#64748B", "#F8FAFC"], at: "2026-08-30T14:30:00.000Z" },
];

function demoGallery() {
  return {
    enabled: true,
    canManage: true,
    eventId: DEMO_EVENT.id,
    eventSlug: "demo-hackathon-2026",
    eventName: DEMO_EVENT.name,
    startDate: DEMO_EVENT.start_date,
    endDate: DEMO_EVENT.end_date,
    maxPhotos: 200,
    items: PHOTOS.map((p, i) => {
      const fileId = `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`;
      return {
        id: 7100 + i,
        fileId,
        url: scene(i + 3, p.colours[0], p.colours[1], p.colours[2]),
        caption: p.caption,
        position: i + 1,
        createdAt: p.at,
      };
    }),
    shared: { chatAt: "2026-08-29T20:15:00.000Z", emailAt: null },
  };
}

export function resolveGalleryDemo(s: string[]): unknown | undefined {
  if (s[0] === "events" && s[2] === "gallery" && s.length === 3) return demoGallery();
  return undefined;
}
