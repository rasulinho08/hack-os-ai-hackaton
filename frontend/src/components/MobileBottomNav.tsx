"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LucideIcon } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";

interface NavItem {
  href: string;
  icon: LucideIcon;
  label?: string;
  labelKey?: string;
}

interface MobileBottomNavProps {
  items: NavItem[];
  basePath: string;
}

export function MobileBottomNav({ items, basePath }: MobileBottomNavProps) {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#1F1F1F]/95 backdrop-blur-lg lg:hidden">
      <div className="flex items-center justify-around px-1 pb-safe">
        {items.map(({ href, icon: Icon, label, labelKey }) => {
          const isActive =
            href === basePath ? pathname === href : pathname.startsWith(href);
          const text = labelKey ? t(labelKey) : (label ?? "");

          return (
            <Link
              key={href}
              href={href}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 transition-colors ${
                isActive
                  ? "text-[#E1003C]"
                  : "text-[var(--app-muted-2)] hover:text-white"
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="block max-w-full truncate text-[11px] font-medium leading-tight">
                {text}
              </span>
              {isActive && (
                <span className="absolute bottom-0.5 h-0.5 w-6 rounded-full bg-[#E1003C]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
