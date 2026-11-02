"use client";

/**
 * University field: the official list of Azerbaijan first, then universities
 * worldwide, searched on the server as you type. Anything typed is accepted
 * too, so a university missing from both lists never blocks a registration.
 */

import { useId, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { fieldClass, fieldStyle } from "./registerUi";

interface Uni { id: string; name: string; country: string }

export function UniversityInput({
  value, onChange, placeholder, invalid, describedBy, id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  id?: string;
}) {
  const auto = useId();
  const listId = `${id || auto}-list`;
  const [q, setQ] = useState(value || "");
  const [items, setItems] = useState<Uni[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the value when the form changes it (a pick, a reset), without an effect.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setQ(value || "");
  }

  const search = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const rows = await apiGet<Uni[]>(`/api/universities?q=${encodeURIComponent(text)}&limit=12`);
        setItems(Array.isArray(rows) ? rows.slice(0, 12) : []);
        setActive(-1);
      } catch {
        setItems([]);
      }
    }, 180);
  };

  const pick = (u: Uni) => {
    setQ(u.name);
    onChange(u.name);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={q}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); search(q); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); search(e.target.value); }}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
          if (e.key === "Escape") setOpen(false);
        }}
        className={fieldClass}
        style={fieldStyle(invalid ? "invalid" : null)}
      />
      {open && items.length > 0 ? (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[12px] border py-1 shadow-xl"
          style={{ background: "var(--surface)", borderColor: "var(--line-strong)" }}>
          {items.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(u); }}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-[14px]"
              style={{ background: i === active ? "var(--tint)" : "transparent", color: "var(--ink)" }}>
              <span className="min-w-0">{u.name}</span>
              <span className="shrink-0 text-[11.5px] font-medium" style={{ color: "var(--ink-3)" }}>{u.country}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
