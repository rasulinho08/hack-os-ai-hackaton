"use client";

/**
 * Search the whole platform from the console's top bar.
 *
 * Organisations, people (name or e-mail), orders (number or invoice number)
 * and events (name or code) come from one owner-only request,
 * `/api/owner/search`, sent when the owner pauses typing and cancelled when
 * they type on. The console's pages are matched here, without a request.
 *
 * Keyboard: ⌘K / Ctrl+K or "/" opens it, ↑ ↓ move, Enter opens, Esc closes.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, CornerDownLeft, Loader2, Receipt, Search, User, X, type LucideIcon } from "lucide-react";
import { searchOwner, type SearchResult } from "@/lib/superadmin/directory";
import { STATUS_LABEL, type OrderStatus } from "@/lib/commerce";
import { PHASE_LABEL } from "@/lib/superadmin/owner";
import { hrefFor, money } from "./_ui";

export interface SearchPage {
  href: string;
  label: string;
  hint: string;
}

interface Hit {
  id: string;
  group: string;
  icon?: LucideIcon;
  label: string;
  hint: string;
  href: string;
}

const MIN = 2;

function hitsFrom(r: SearchResult): Hit[] {
  return [
    ...r.organisations.map((o) => ({
      id: `org-${o.id}`, group: "Organisations", icon: Building2, label: o.name,
      hint: [o.archived_at ? "Archived" : null, [o.city, o.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || `#${o.id}`,
      href: hrefFor.organisation(o.id),
    })),
    ...r.people.map((p) => ({
      id: `user-${p.id}`, group: "People", icon: User, label: p.full_name || p.email, hint: p.email, href: hrefFor.person(p.id),
    })),
    ...r.orders.map((o) => ({
      id: `order-${o.id}`, group: "Orders", icon: Receipt, label: `${o.order_code} · ${o.customer_name}`,
      hint: [STATUS_LABEL[o.status as OrderStatus] ?? o.status, money(o.amount_minor, o.currency)].join(" · "),
      href: hrefFor.order(o.id),
    })),
    ...r.events.map((e) => ({
      id: `event-${e.id}`, group: "Events", icon: CalendarDays, label: e.name,
      hint: [e.event_code, PHASE_LABEL[e.phase] ?? e.phase, e.customer_name].filter(Boolean).join(" · "),
      href: hrefFor.event(e.id),
    })),
  ];
}

export function GlobalSearch({ pages }: { pages: SearchPage[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResult(null);
    setActive(0);
    opener.current?.focus?.();
  }, []);

  // ⌘K / Ctrl+K anywhere; "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable=true]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement | null;
        setOpen((v) => !v);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // One request when typing pauses; the previous one is cancelled.
  const q = query.trim();
  useEffect(() => {
    if (!open || q.length < MIN) return;
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      setState("loading");
      searchOwner(q, ctl.signal)
        .then((r) => {
          if (ctl.signal.aborted) return;
          setResult(r);
          setState("idle");
          setActive(0);
        })
        .catch(() => {
          if (!ctl.signal.aborted) setState("error");
        });
    }, 220);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [q, open]);

  const hits: Hit[] = useMemo(() => {
    const lower = q.toLowerCase();
    const pageHits = pages
      .filter((p) => !lower || `${p.label} ${p.hint}`.toLowerCase().includes(lower))
      .slice(0, lower ? 4 : 14)
      .map((p) => ({ id: `page-${p.href}`, group: "Go to", label: p.label, hint: p.hint, href: p.href }));
    const remote = q.length >= MIN && result && result.q === q ? hitsFrom(result) : [];
    return [...remote, ...pageHits];
  }, [q, pages, result]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    setOpen(false);
    setQuery("");
    setResult(null);
    router.push(h.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (hits.length ? (i + 1) % hits.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  // Keep the active row in view while moving with the keyboard.
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const searching = q.length >= MIN && (state === "loading" || !result || result.q !== q);
  const pending = q.length > 0 && q.length < MIN;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          opener.current = e.currentTarget;
          setOpen(true);
        }}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] border px-3 text-left text-sm"
        style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink-3)", maxWidth: 460, background: "var(--hs-bg)" }}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Search size={15} className="shrink-0" />
        <span className="flex-1 truncate">
          <span className="hidden sm:inline">Search organisations, people, orders, events</span>
          <span className="sm:hidden">Search</span>
        </span>
        <kbd className="hidden rounded px-1.5 py-0.5 text-[10px] sm:inline" style={{ background: "var(--hs-raised)", color: "var(--hs-ink-3)" }}>
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[10vh] sm:px-4" role="dialog" aria-modal="true" aria-label="Search the platform">
          <button aria-label="Close search" tabIndex={-1} className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={close} />
          <div
            className="relative w-full max-w-xl overflow-hidden rounded-[var(--hs-radius)] border shadow-2xl"
            style={{ borderColor: "var(--hs-line-2)", background: "var(--hs-surface)" }}
          >
            <div className="flex items-center gap-2 border-b px-4" style={{ borderColor: "var(--hs-line)" }}>
              {searching ? (
                <Loader2 size={16} className="shrink-0 animate-spin" style={{ color: "var(--hs-ink-3)" }} />
              ) : (
                <Search size={16} className="shrink-0" style={{ color: "var(--hs-ink-3)" }} />
              )}
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Organisation, name or e-mail, order number, event code…"
                className="min-h-12 min-w-0 flex-1 bg-transparent text-sm"
                // The open dialog is the focus indicator; the global ring would box the field in.
                style={{ color: "var(--hs-ink)", outline: "none" }}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
                aria-autocomplete="list"
              />
              <button type="button" onClick={close} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md" style={{ color: "var(--hs-ink-3)" }}>
                <X size={16} />
              </button>
            </div>

            <ul id={listId} role="listbox" aria-label="Results" className="max-h-[56vh] overflow-y-auto py-1.5">
              {state === "error" && q.length >= MIN ? (
                <li className="px-4 py-3 text-sm" style={{ color: "var(--hs-warn)" }} role="presentation">
                  The search did not answer. Keep typing to try again.
                </li>
              ) : null}
              {pending ? (
                <li className="px-4 py-3 text-xs" style={{ color: "var(--hs-ink-3)" }} role="presentation">
                  Type one more letter to search the platform.
                </li>
              ) : null}
              {q.length >= MIN && !searching && state !== "error" && hits.every((h) => h.group === "Go to") ? (
                <li className="px-4 py-3 text-sm" style={{ color: "var(--hs-ink-3)" }} role="presentation">
                  No organisation, person, order or event matches “{q}”.
                </li>
              ) : null}
              {hits.map((h, i) => {
                const first = i === 0 || hits[i - 1].group !== h.group;
                const Icon = h.icon;
                const on = i === active;
                return (
                  <li key={h.id} role="presentation">
                    {first ? (
                      <p className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--hs-ink-3)" }}>
                        {h.group}
                      </p>
                    ) : null}
                    <div
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={on}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(h)}
                      className="mx-1.5 flex min-h-11 cursor-pointer items-center gap-3 rounded-[7px] px-2.5 text-sm"
                      style={{ background: on ? "var(--hs-tint)" : "transparent", color: "var(--hs-ink)" }}
                    >
                      {Icon ? <Icon size={15} className="shrink-0" style={{ color: "var(--hs-ink-3)" }} /> : <span className="w-[15px]" />}
                      <span className="min-w-0 flex-1 truncate">{h.label}</span>
                      <span className="hidden max-w-[45%] truncate text-xs sm:inline" style={{ color: "var(--hs-ink-3)" }}>{h.hint}</span>
                      {on ? <CornerDownLeft size={13} className="shrink-0" style={{ color: "var(--hs-ink-3)" }} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden items-center gap-4 border-t px-4 py-2 text-[11px] sm:flex" style={{ borderColor: "var(--hs-line)", color: "var(--hs-ink-3)" }}>
              <span>↑ ↓ to move</span>
              <span>Enter to open</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
