"use client";

/**
 * Site header and footer, in the reader's language (AZ, EN, RU).
 *
 * The header floats: a rounded bar inset from the edges that turns solid
 * once the page scrolls. A few plain links, the current one sitting on a
 * soft pill; language, theme and the two calls to action on the right.
 * Below the large breakpoint the links fold into a panel that drops out of
 * the same bar. The footer carries the legal pages.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { LEGAL_LINKS, LEGAL_OPERATOR, legalLabel } from "@/lib/legal";
import { CONTACT_EMAIL } from "@/lib/site";
import { useSiteTheme } from "./_theme";

type ChromeLang = "en" | "az" | "ru";

const WORDS = {
  en: {
    platform: "Platform", solutions: "Solutions", stories: "Stories", hackathons: "Hackathons", status: "Status", pricing: "Pricing", contact: "Contact", demo: "Live demo",
    signIn: "Sign in", account: "My account", openMenu: "Open menu", closeMenu: "Close menu", language: "Language", main: "Main",
    toLight: "Switch to light theme", toDark: "Switch to dark theme", home: "HackOS home",
    tagline: "Hackathon management for organisations that run more than one. Built in Azerbaijan.",
    groups: { platform: "Platform", solutions: "Solutions", company: "Company", legal: "Legal", contact: "Contact" },
    overview: "Overview", universities: "Universities", corporates: "Corporates", accelerators: "Accelerators", publicSector: "Public sector",
    rights: "All rights reserved.",
  },
  az: {
    platform: "Platforma", solutions: "Həllər", stories: "Hekayələr", hackathons: "Hackathonlar", status: "Status", pricing: "Qiymətlər", contact: "Əlaqə", demo: "Canlı demo",
    signIn: "Daxil ol", account: "Hesabım", openMenu: "Menyunu aç", closeMenu: "Menyunu bağla", language: "Dil", main: "Əsas",
    toLight: "İşıqlı temaya keç", toDark: "Qaranlıq temaya keç", home: "HackOS ana səhifə",
    tagline: "Birdən çox hackathon keçirən təşkilatlar üçün idarəetmə platforması. Azərbaycanda hazırlanıb.",
    groups: { platform: "Platforma", solutions: "Həllər", company: "Şirkət", legal: "Hüquqi", contact: "Əlaqə" },
    overview: "İcmal", universities: "Universitetlər", corporates: "Şirkətlər", accelerators: "Akseleratorlar", publicSector: "Dövlət sektoru",
    rights: "Bütün hüquqlar qorunur.",
  },
  ru: {
    platform: "Платформа", solutions: "Решения", stories: "Истории", hackathons: "Хакатоны", status: "Статус", pricing: "Цены", contact: "Контакты", demo: "Живое демо",
    signIn: "Войти", account: "Мой аккаунт", openMenu: "Открыть меню", closeMenu: "Закрыть меню", language: "Язык", main: "Основное",
    toLight: "Светлая тема", toDark: "Тёмная тема", home: "HackOS — главная",
    tagline: "Управление хакатонами для организаций, которые проводят больше одного. Сделано в Азербайджане.",
    groups: { platform: "Платформа", solutions: "Решения", company: "Компания", legal: "Правовая информация", contact: "Контакты" },
    overview: "Обзор", universities: "Университеты", corporates: "Компании", accelerators: "Акселераторы", publicSector: "Госсектор",
    rights: "Все права защищены.",
  },
} as const;

function useWords() {
  const { lang } = useTranslation();
  const l: ChromeLang = lang === "az" || lang === "ru" ? lang : "en";
  return { w: WORDS[l], lang: l };
}

/* The platform lives on the home page now; /welcome is that page on every host. */
const navOf = (w: (typeof WORDS)[ChromeLang]): { href: string; label: string }[] => [
  { href: "/welcome#platform", label: w.platform },
  { href: "/solutions", label: w.solutions },
  { href: "/hackathons", label: w.hackathons },
  { href: "/pricing", label: w.pricing },
  { href: "/contact", label: w.contact },
];

const LANGS = [
  { code: "az", label: "AZ" },
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
] as const;

function Brand({ size = 26 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={size} height={size} />
      <span className="text-[17px] font-semibold tracking-[-0.02em]" style={{ color: "var(--hs-ink)" }}>
        HackOS
      </span>
    </span>
  );
}

function ThemeButton() {
  const { theme, toggle } = useSiteTheme();
  const { w } = useWords();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? w.toLight : w.toDark}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--hs-tint)]"
      style={{ color: "var(--hs-ink-2)" }}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function LangSwitch() {
  const { lang, setLang } = useTranslation();
  const { w } = useWords();
  return (
    <div
      role="group"
      aria-label={w.language}
      className="hidden items-center rounded-full p-0.5 md:flex"
      style={{ background: "var(--hs-tint)" }}
    >
      {LANGS.map((l) => {
        const active = lang === l.code;
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => setLang(l.code)}
            aria-pressed={active}
            className="hs-mono h-8 rounded-full px-2.5 text-[11px] font-medium transition-colors"
            style={{
              background: active ? "var(--hs-surface)" : "transparent",
              color: active ? "var(--hs-ink)" : "var(--hs-ink-3)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            }}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

/*
 * Signed in on this site: the sign-in page leaves hh_email (14 days) and
 * signing out clears it. A cookie, not a request, so anonymous visitors cost
 * the API nothing; the account page checks the session itself.
 */
const noSubscribe = () => () => {};
const hasAccountCookie = () => /(?:^|;\s*)hh_email=[^;]/.test(document.cookie);
function useSignedIn() {
  return useSyncExternalStore(noSubscribe, hasAccountCookie, () => false);
}

export function SiteHeader() {
  const pathname = usePathname() || "";
  const { w } = useWords();
  const signedIn = useSignedIn();
  const NAV = navOf(w);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div
        className="mx-auto max-w-6xl rounded-[28px] border backdrop-blur-xl transition-[background-color,box-shadow,border-color] duration-300"
        style={{
          borderColor: "var(--hs-line)",
          background: scrolled || open ? "var(--hs-header-bg)" : "color-mix(in srgb, var(--hs-header-bg) 55%, transparent)",
          boxShadow: scrolled ? "0 12px 40px -24px rgba(15, 18, 30, 0.35)" : "none",
        }}
      >
        <div className="flex h-16 items-center justify-between gap-3 pl-5 pr-2.5 sm:pl-6">
          <Link href="/welcome" aria-label={w.home} onClick={() => setOpen(false)}>
            <Brand />
          </Link>

          <nav aria-label={w.main} className="hidden items-center gap-1 lg:flex">
            {NAV.map((n) => {
              const active = isActive(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className="inline-flex h-10 items-center whitespace-nowrap rounded-full px-3 text-[15px] transition-colors hover:text-[var(--hs-ink)] xl:px-4"
                  style={{
                    background: active ? "var(--hs-tint-2)" : "transparent",
                    color: active ? "var(--hs-ink)" : "var(--hs-ink-2)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5">
            <LangSwitch />
            <ThemeButton />
            <Link
              href="/demo"
              className="hidden h-10 items-center whitespace-nowrap rounded-full px-4 text-[14px] font-medium sm:inline-flex"
              style={{ color: "var(--hs-ink)" }}
            >
              {w.demo}
            </Link>
            <a
              href={signedIn ? "/account" : "/signin"}
              className="inline-flex h-10 items-center whitespace-nowrap rounded-full px-5 text-[14px] font-medium transition-colors"
              style={{ background: "var(--hs-ink)", color: "var(--hs-bg)" }}
            >
              {signedIn ? w.account : w.signIn}
            </a>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? w.closeMenu : w.openMenu}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full lg:hidden"
              style={{ color: "var(--hs-ink-2)" }}
            >
              {open ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </div>

        {open && (
          <nav aria-label={w.main} className="hs-fade border-t px-3 pb-4 pt-2 lg:hidden" style={{ borderColor: "var(--hs-line)" }}>
            {NAV.concat([{ href: "/demo", label: w.demo }]).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center justify-between rounded-2xl px-3 text-[16px]"
                style={{
                  color: isActive(n.href) ? "var(--hs-ink)" : "var(--hs-ink-2)",
                  background: isActive(n.href) ? "var(--hs-tint)" : "transparent",
                }}
              >
                {n.label}
                <ArrowUpRight size={16} style={{ color: "var(--hs-ink-3)" }} />
              </Link>
            ))}
            <div className="mt-3 px-3 md:hidden">
              <LangSwitchMobile />
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}

function LangSwitchMobile() {
  const { lang, setLang } = useTranslation();
  const { w } = useWords();
  return (
    <div role="group" aria-label={w.language} className="flex gap-2">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          aria-pressed={lang === l.code}
          className="hs-mono h-9 flex-1 rounded-full border text-[12px]"
          style={{
            borderColor: lang === l.code ? "var(--hs-ink)" : "var(--hs-line-2)",
            color: lang === l.code ? "var(--hs-ink)" : "var(--hs-ink-3)",
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

const footerOf = (w: (typeof WORDS)[ChromeLang], lang: ChromeLang): { title: string; links: { href: string; label: string }[] }[] => [
  {
    title: w.groups.platform,
    links: [
      { href: "/welcome#platform", label: w.overview },
      { href: "/demo", label: w.demo },
      { href: "/pricing", label: w.pricing },
    ],
  },
  {
    title: w.groups.solutions,
    links: [
      { href: "/solutions#universities", label: w.universities },
      { href: "/solutions#corporates", label: w.corporates },
      { href: "/solutions#accelerators", label: w.accelerators },
      { href: "/solutions#public", label: w.publicSector },
    ],
  },
  {
    title: w.groups.company,
    links: [
      { href: "/hackathons", label: w.hackathons },
      { href: "/contact", label: w.contact },
      { href: "/status", label: w.status },
      { href: "/signin", label: w.signIn },
    ],
  },
  {
    title: w.groups.legal,
    links: LEGAL_LINKS.map((l) => ({ href: l.href, label: legalLabel(l.id, lang) })),
  },
];

export function SiteFooter() {
  const { w, lang } = useWords();
  const FOOTER = footerOf(w, lang);
  return (
    <footer className="relative border-t" style={{ borderColor: "var(--hs-line)" }}>
      <div className="mx-auto max-w-6xl px-5 pb-10 pt-16 sm:px-8">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1.1fr_1.3fr]">
          <div className="col-span-2 md:col-span-1">
            <Brand size={28} />
            <p className="mt-5 max-w-[17rem] text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
              {w.tagline}
            </p>
          </div>

          {FOOTER.map((g) => (
            <div key={g.title}>
              <p className="hs-mono mb-4 text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--hs-ink-3)" }}>
                {g.title}
              </p>
              <ul className="space-y-3">
                {g.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="text-[15px] transition-colors hover:text-[var(--hs-ink)]" style={{ color: "var(--hs-ink-2)" }}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="col-span-2 md:col-span-1">
            <p className="hs-mono mb-4 text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--hs-ink-3)" }}>
              {w.groups.contact}
            </p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="break-all text-[14px] hover:text-[var(--hs-ink)]" style={{ color: "var(--hs-ink-2)" }}>
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>

        <div
          className="mt-14 flex flex-col gap-2 border-t pt-6 text-[13px] sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: "var(--hs-line)", color: "var(--hs-ink-3)" }}
        >
          <span>
            © {new Date().getFullYear()} HackOS. {w.rights}
            {/* The registered operator, once NEXT_PUBLIC_LEGAL_NAME / _TAX_ID are set. */}
            {LEGAL_OPERATOR.legalName ? (
              <span className="mt-1 block sm:mt-0 sm:inline">
                {" "}
                {LEGAL_OPERATOR.legalName}
                {LEGAL_OPERATOR.taxId ? ` · VÖEN ${LEGAL_OPERATOR.taxId}` : ""}
              </span>
            ) : null}
          </span>
          <span className="hs-mono text-[12px]">Azərbaycan · English · Русский</span>
        </div>
      </div>
    </footer>
  );
}
