/* ═══════════════════════════════════════════════
   Admin sidebar — single source of truth.
   Both DashboardShell (rendered nav) and GlobalSearch
   (⌘K palette) consume this list. Adding a new admin
   page here automatically makes it appear in BOTH the
   sidebar AND the search palette, so the two never
   drift apart.
   ═══════════════════════════════════════════════ */

import {
  LayoutDashboard,
  Users,
  UsersRound,
  FileText,
  Trophy,
  Medal,
  Scale,
  GraduationCap,
  HelpCircle,
  Megaphone,
  BarChart3,
  BookOpen,
  Settings,
  HeartHandshake,
  ShieldAlert,
  MessageSquare,
  MessagesSquare,
  Presentation,
  Archive,
  Award,
  Images,
  ScanLine,
  MailPlus,
  type LucideIcon,
} from "lucide-react";

export interface SidebarMenuItem {
  /** i18n key — translated to the visible nav label */
  labelKey: string;
  /** Absolute path inside the admin shell */
  href: string;
  /** Lucide icon to render in the sidebar / search palette */
  icon: LucideIcon;
  /**
   * Extra match terms the user might type into the search palette.
   * Include English + Azerbaijani + Russian aliases so the entry is
   * findable regardless of which language the UI is currently set to.
   */
  searchKeywords?: string[];
  /**
   * The plan module this page belongs to (see the API's constants/modules.js).
   * When the event's plan does not include it, the item shows a lock and the
   * page shows what the plan does not cover instead of failing requests.
   */
  module?: string;
}

/**
 * The sidebar, grouped by where the event is, the way the builder groups its
 * sections: setting up, registration, during the event, judging and results,
 * and after. Dashboard sits above the groups. Every address stays the same.
 */
export interface SidebarGroup {
  key: "setup" | "registration" | "during" | "judging" | "after";
  /** i18n key of the group's heading */
  labelKey: string;
  items: SidebarMenuItem[];
}

export const adminSidebarHome: SidebarMenuItem = {
  labelKey: "nav.dashboard",
  href: "/",
  icon: LayoutDashboard,
  searchKeywords: ["home", "overview", "main", "ana", "əsas", "главная", "обзор"],
};

export const adminSidebarGroups: SidebarGroup[] = [
  {
    key: "setup",
    labelKey: "nav.group.setup",
    items: [
      {
        labelKey: "nav.settings",
        href: "/settings",
        icon: Settings,
        searchKeywords: ["config", "preferences", "options", "parametr", "parametrlər", "ayarlar", "настройки", "конфиг"],
      },
      {
        labelKey: "nav.resources",
        href: "/resources",
        module: "resources",
        icon: BookOpen,
        searchKeywords: ["materials", "links", "docs", "resurs", "resurslar", "materiallar", "ресурс", "ресурсы", "материалы"],
      },
      {
        labelKey: "nav.mentor",
        href: "/mentors",
        module: "mentors",
        icon: GraduationCap,
        searchKeywords: ["mentors", "coaches", "help", "support", "mentor", "mentorlar", "ментор", "менторы"],
      },
      {
        labelKey: "nav.volunteer",
        href: "/volunteers",
        module: "volunteers",
        icon: HeartHandshake,
        searchKeywords: ["volunteers", "staff", "könüllü", "könüllülər", "волонтёр", "волонтер", "волонтёры", "волонтеры"],
      },
    ],
  },
  {
    key: "registration",
    labelKey: "nav.group.registration",
    items: [
      {
        labelKey: "nav.participants",
        href: "/participants",
        icon: Users,
        searchKeywords: ["people", "users", "hackers", "iştirakçı", "iştirakçılar", "участник", "участники"],
      },
      {
        labelKey: "nav.invitations",
        href: "/invitations",
        icon: MailPlus,
        searchKeywords: ["invite", "invitations", "invite-only", "personal link", "dəvət", "dəvətlər", "приглашение", "приглашения", "пригласить"],
      },
      {
        labelKey: "nav.teams",
        href: "/teams",
        icon: UsersRound,
        searchKeywords: ["groups", "squads", "komanda", "komandalar", "команда", "команды"],
      },
      {
        labelKey: "nav.checkin",
        href: "/checkin",
        module: "checkin",
        icon: ScanLine,
        searchKeywords: ["check-in", "checkin", "door", "entrance", "ticket", "qr", "scan", "giriş", "bilet", "skan", "qeydiyyat", "вход", "билет", "сканер", "регистрация"],
      },
    ],
  },
  {
    key: "during",
    labelKey: "nav.group.during",
    items: [
      {
        labelKey: "nav.announcements",
        href: "/announcements",
        icon: Megaphone,
        searchKeywords: ["news", "broadcast", "elan", "elanlar", "xəbər", "объявление", "объявления", "новости"],
      },
      {
        labelKey: "nav.chat",
        href: "/chat",
        module: "chat",
        icon: MessagesSquare,
        searchKeywords: ["chat", "messages", "support", "moderation", "çat", "mesaj", "mesajlar", "dəstək", "чат", "сообщения", "поддержка", "модерация"],
      },
      {
        labelKey: "nav.help_queue",
        href: "/help-queue",
        module: "mentors",
        icon: HelpCircle,
        searchKeywords: ["tickets", "queue", "support", "yardım", "növbə", "ticketlər", "помощь", "тикеты", "очередь"],
      },
      {
        labelKey: "nav.submissions",
        href: "/submissions",
        icon: FileText,
        searchKeywords: ["projects", "repos", "layihə", "layihələr", "təqdimatlar", "проект", "проекты"],
      },
      {
        labelKey: "nav.gallery",
        href: "/gallery",
        module: "gallery",
        icon: Images,
        searchKeywords: ["photos", "pictures", "gallery", "foto", "şəkil", "şəkillər", "qalereya", "фото", "фотографии", "галерея"],
      },
    ],
  },
  {
    key: "judging",
    labelKey: "nav.group.judging",
    items: [
      {
        labelKey: "nav.judge",
        href: "/judges",
        icon: Scale,
        searchKeywords: ["judges", "jury", "scoring", "evaluation", "hakim", "hakimlər", "münsif", "судья", "судьи", "жюри"],
      },
      {
        labelKey: "nav.presentations",
        href: "/presentations",
        module: "presentations",
        icon: Presentation,
        searchKeywords: ["pitch", "demo", "slides", "təqdimat", "презентация", "презентации", "питч"],
      },
      {
        labelKey: "nav.results",
        href: "/results",
        icon: Trophy,
        searchKeywords: ["podium", "winners", "leaderboard", "podyum", "qaliblər", "пьедестал", "победители"],
      },
      {
        labelKey: "nav.certificates",
        href: "/certificates",
        module: "certificates",
        icon: Award,
        searchKeywords: ["certificate", "diploma", "award", "sertifikat", "diplom", "сертификат", "диплом", "грамота"],
      },
    ],
  },
  {
    key: "after",
    labelKey: "nav.group.after",
    items: [
      {
        labelKey: "nav.feedback",
        href: "/feedback",
        icon: MessageSquare,
        searchKeywords: ["reviews", "comments", "rəy", "rəylər", "geri bildiriş", "отзыв", "отзывы", "обратная связь"],
      },
      {
        labelKey: "nav.analytics",
        href: "/analytics",
        icon: BarChart3,
        searchKeywords: ["stats", "charts", "metrics", "analitika", "statistika", "qrafik", "аналитика", "статистика", "метрики"],
      },
      {
        labelKey: "nav.archive",
        href: "/archive",
        icon: Archive,
        searchKeywords: ["history", "past events", "arxiv", "tarixçə", "архив", "история"],
      },
    ],
  },
];

/** Every page in the sidebar, in sidebar order (Dashboard first). */
export const adminSidebarMenu: SidebarMenuItem[] = [adminSidebarHome, ...adminSidebarGroups.flatMap((g) => g.items)];

/**
 * Pages that are reached from another page rather than the sidebar: the big
 * screen from Results, elimination from Teams. They keep their addresses,
 * their plan module, and a place in the search palette; the sidebar marks
 * the page they belong to.
 */
export interface SubPage extends SidebarMenuItem {
  /** The sidebar entry shown as current while on this page. */
  parent: string;
}

export const adminSubPages: SubPage[] = [
  {
    labelKey: "nav.big_screen",
    href: "/leaderboard",
    icon: Medal,
    parent: "/results",
    searchKeywords: ["big screen", "projector", "presenter", "leaderboard", "böyük ekran", "проектор", "большой экран", "ranking", "ranks", "scores", "lider", "lider lövhəsi", "reytinq", "рейтинг", "лидерборд", "таблица"],
  },
  {
    labelKey: "nav.eliminate",
    href: "/eliminate",
    module: "elimination",
    icon: ShieldAlert,
    parent: "/teams",
    searchKeywords: ["disqualify", "remove", "ban", "kick", "kənarlaşdır", "diskvalifikasiya", "исключить", "дисквал"],
  },
];

/** Everything the search palette can open: the sidebar and the pages reached from it. */
export const adminSearchPages: SidebarMenuItem[] = [...adminSidebarMenu, ...adminSubPages];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * The page an address belongs to, for its plan module, and the sidebar entry
 * to mark as current: the entry itself, or a sub-page's parent. `base` is the
 * prefix the shell is mounted under (the walkthrough's "/demo").
 */
export function sidebarPageFor(pathname: string, base = ""): { page: SidebarMenuItem | null; current: string | null } {
  const at = (href: string) => (base ? `${base}${href === "/" ? "" : href}` || "/" : href);
  if (pathname === at("/") || pathname === `${at("/")}/`) return { page: adminSidebarHome, current: "/" };
  const sub = adminSubPages.find((p) => under(pathname, at(p.href)));
  if (sub) return { page: sub, current: sub.parent };
  const page = adminSidebarMenu.find((m) => m.href !== "/" && under(pathname, at(m.href))) ?? null;
  return { page, current: page?.href ?? null };
}
