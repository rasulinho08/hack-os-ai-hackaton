"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";
import { useTranslation, type Lang } from "@/contexts/LanguageContext";
import { adminSearchPages } from "@/lib/sidebarMenu";
import { resolve } from "@/lib/i18n";

/** `compact`: below wide screens the trigger is only the icon (the header on tablets). */
export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const router = useRouter();

  /**
   * The palette must find a sidebar entry no matter which language the
   * user types it in (e.g. typing "komandalar" while UI is on EN, or
   * "teams" while UI is on RU). Build a per-item haystack that includes:
   *   • the label translated into ALL supported languages
   *   • all author-supplied keyword aliases
   * so a single substring match against the user's query is enough.
   */
  const ALL_LANGS: Lang[] = ["en", "az", "ru"];
  const indexedItems = useMemo(
    () =>
      adminSearchPages.map((item) => {
        const labelsByLang = ALL_LANGS.map((l) =>
          String(resolve(l, item.labelKey) ?? "").toLowerCase(),
        );
        const keywords = (item.searchKeywords ?? []).map((k) =>
          String(k ?? "").toLowerCase(),
        );
        return {
          ...item,
          haystack: [...labelsByLang, ...keywords],
        };
      }),
    // ALL_LANGS is a constant so the index only has to be built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return indexedItems.slice(0, 8);
    return indexedItems.filter((item) =>
      item.haystack.some((s) => String(s ?? "").includes(q)),
    );
  }, [query, indexedItems]);

  const goTo = useCallback(
    (href: string) => {
      router.push(href);
      setOpen(false);
      setQuery("");
      setSelected(0);
    },
    [router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setSelected(0);
      }
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, Math.max(filtered.length - 1, 0)));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      }
      if (e.key === "Enter" && filtered[selected]) {
        e.preventDefault();
        goTo(filtered[selected].href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, selected, goTo]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 cursor-pointer rounded-lg border border-white/10 bg-white/5 text-[15px] text-[var(--app-muted)] transition-colors hover:border-white/20 hover:text-[var(--app-heading)] ${compact ? "p-2 xl:px-3 xl:py-1.5" : "px-3 py-1.5"}`}
        title={t("search.title")}
        aria-label={t("search.title")}
      >
        <Search size={16} />
        <span className={compact ? "hidden xl:inline" : "hidden sm:inline"}>{t("search.trigger")}</span>
        <kbd className={`hidden rounded bg-white/10 px-1.5 py-0.5 text-[11px] ${compact ? "xl:inline" : "sm:inline"}`}>
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[95] flex items-start justify-center pt-[15vh] p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="relative w-full max-w-xl rounded-2xl border border-white/10 bg-[var(--app-surface)] shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
              <Search size={18} className="text-[var(--app-muted)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(0);
                }}
                placeholder={t("search.placeholder")}
                className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[var(--app-muted-2)]"
              />
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-[var(--app-muted)]">
                ESC
              </kbd>
            </div>
            <div className="max-h-72 overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-[15px] text-[var(--app-muted)]">
                  {t("search.no_results")}
                </p>
              ) : (
                filtered.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.href + item.labelKey}
                      onClick={() => goTo(item.href)}
                      onMouseEnter={() => setSelected(i)}
                      className={`flex w-full items-center gap-3 cursor-pointer px-4 py-2.5 text-left text-[15px] transition-colors ${
                        i === selected
                          ? "bg-[#E1003C]/15 text-white"
                          : "text-[var(--app-muted)] hover:bg-white/5"
                      }`}
                    >
                      <Icon size={18} className="shrink-0 text-[#E1003C]" />
                      <span className="flex-1">{t(item.labelKey)}</span>
                      <ArrowRight size={14} className="text-[var(--app-muted)]" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
