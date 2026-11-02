"use client";

/**
 * The mentor portal's frame — a nav list and a badge; everything structural
 * lives in RoleShell.
 */

import {
  BookOpen,
  GraduationCap,
  HelpCircle,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Users,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { MentorHeartbeat } from "@/components/help/MentorHeartbeat";
import { StaffEventBar } from "@/components/StaffEventBar";

const NAV = [
  { labelKey: "nav.dashboard", href: "/mentor", icon: LayoutDashboard },
  { labelKey: "nav.help_queue", href: "/mentor/help-queue", icon: HelpCircle },
  { labelKey: "mentor.nav.my_tickets", href: "/mentor/my-tickets", icon: MessageSquare },
  { labelKey: "nav.chat", href: "/mentor/chat", icon: MessagesSquare },
  { labelKey: "nav.teams", href: "/mentor/teams", icon: Users },
  { labelKey: "nav.announcements", href: "/mentor/announcements", icon: Megaphone },
  { labelKey: "nav.resources", href: "/mentor/resources", icon: BookOpen },
];

export default function MentorShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleShell
      basePath="/mentor"
      nav={NAV}
      badge={{ icon: GraduationCap, labelKey: "mentor.header_badge", tone: "ok" }}
      menuTitleKey="mentor.menu_title"
      footerTagKey="mentor.footer_tag"
      mobileNav={[
        { href: "/mentor", icon: LayoutDashboard, labelKey: "mobile_nav.home" },
        { href: "/mentor/help-queue", icon: HelpCircle, labelKey: "mobile_nav.queue" },
        { href: "/mentor/my-tickets", icon: MessageSquare, labelKey: "mobile_nav.tickets" },
        { href: "/mentor/teams", icon: Users, labelKey: "mobile_nav.teams" },
        { href: "/mentor/announcements", icon: Megaphone, labelKey: "mobile_nav.news" },
      ]}
    >
      <MentorHeartbeat />
      <StaffEventBar role="mentor" />
      {children}
    </RoleShell>
  );
}
