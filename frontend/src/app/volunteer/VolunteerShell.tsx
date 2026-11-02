"use client";

/**
 * The volunteer portal's frame — see MentorShell; the structure is shared.
 */

import {
  ClipboardList,
  HeartHandshake,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  ScanLine,
  Users,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { StaffEventBar } from "@/components/StaffEventBar";

const NAV = [
  { labelKey: "nav.dashboard", href: "/volunteer", icon: LayoutDashboard },
  { labelKey: "volunteer.nav.tasks", href: "/volunteer/tasks", icon: ClipboardList },
  { labelKey: "ci.nav.scan", href: "/volunteer/scan", icon: ScanLine },
  { labelKey: "nav.teams", href: "/volunteer/teams", icon: Users },
  { labelKey: "nav.announcements", href: "/volunteer/announcements", icon: Megaphone },
  { labelKey: "nav.chat", href: "/volunteer/chat", icon: MessagesSquare },
];

export default function VolunteerShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleShell
      basePath="/volunteer"
      nav={NAV}
      badge={{ icon: HeartHandshake, labelKey: "volunteer.header_badge", tone: "ok" }}
      menuTitleKey="volunteer.menu_title"
      footerTagKey="volunteer.footer_tag"
      mobileNav={[
        { href: "/volunteer", icon: LayoutDashboard, labelKey: "mobile_nav.home" },
        { href: "/volunteer/tasks", icon: ClipboardList, labelKey: "mobile_nav.tasks" },
        { href: "/volunteer/scan", icon: ScanLine, labelKey: "ci.nav.scan_short" },
        { href: "/volunteer/teams", icon: Users, labelKey: "mobile_nav.teams" },
        { href: "/volunteer/announcements", icon: Megaphone, labelKey: "mobile_nav.news" },
      ]}
    >
      <StaffEventBar role="volunteer" />
      {children}
    </RoleShell>
  );
}
