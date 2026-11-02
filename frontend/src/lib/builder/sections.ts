/**
 * The twenty builder sections, in the order the wizard walks them, grouped
 * the way the sidebar shows them. `module` is the plan module a section
 * needs; without it the section is shown locked.
 */

import type { LucideIcon } from "lucide-react";
import {
  Award, BadgeCheck, CalendarClock, ClipboardList, FileCheck2, FolderOpen, Gavel, Handshake, HeartHandshake,
  Info, MapPin, Megaphone, Mic, Palette, Scale, Share2, ShieldCheck, Trophy, UserCog, Users,
} from "lucide-react";
import type { ChecklistItem, SectionKey } from "./types";

export interface SectionDef {
  key: SectionKey;
  icon: LucideIcon;
  module?: string;
  group: "basics" | "people" | "content" | "judging" | "team" | "day" | "comms" | "finish";
}

export const SECTIONS: SectionDef[] = [
  { key: "basics", icon: Info, group: "basics" },
  { key: "brand", icon: Palette, module: "branding", group: "basics" },
  { key: "place", icon: MapPin, group: "basics" },
  { key: "schedule", icon: CalendarClock, group: "basics" },
  { key: "registration", icon: Users, group: "people" },
  { key: "eligibility", icon: ShieldCheck, group: "people" },
  { key: "form", icon: ClipboardList, group: "people" },
  { key: "tracks", icon: FolderOpen, group: "content" },
  { key: "prizes", icon: Trophy, group: "content" },
  { key: "sponsors", icon: Handshake, group: "content" },
  { key: "judging", icon: Scale, module: "judging", group: "judging" },
  { key: "judges", icon: Gavel, module: "judging", group: "judging" },
  { key: "mentors", icon: HeartHandshake, module: "mentors", group: "team" },
  { key: "volunteers", icon: UserCog, module: "volunteers", group: "team" },
  { key: "submissions", icon: FileCheck2, module: "submissions", group: "day" },
  { key: "presentation", icon: Mic, module: "presentations", group: "day" },
  { key: "communication", icon: Megaphone, module: "announcements", group: "comms" },
  { key: "resources", icon: BadgeCheck, module: "resources", group: "comms" },
  { key: "certificates", icon: Award, module: "certificates", group: "finish" },
  { key: "share", icon: Share2, group: "finish" },
];

export const SECTION_KEYS = SECTIONS.map((s) => s.key);

export function sectionIndex(key: string): number {
  const i = SECTION_KEYS.indexOf(key as SectionKey);
  return i >= 0 ? i : 0;
}

export type SectionState = "locked" | "error" | "warning" | "done" | "todo";

/** How a section looks in the sidebar: locked by the plan, has errors, has warnings, visited and clean, or not yet seen. */
export function sectionState(
  def: SectionDef,
  modules: string[],
  checklist: ChecklistItem[],
  visited: string[],
): SectionState {
  if (def.module && !modules.includes(def.module)) return "locked";
  const mine = checklist.filter((i) => i.section === def.key);
  if (mine.some((i) => i.severity === "error")) return "error";
  if (!visited.includes(def.key)) return "todo";
  if (mine.some((i) => i.severity === "warning")) return "warning";
  return "done";
}
