"use client";

import Link from "next/link";
import { useState } from "react";
import { SearchX } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";

/** A code that matches no open event: say so and let the person try another. */
export function JoinCodeNotFound({ code }: { code: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(code.toUpperCase());
  return (
    <main className="hs flex min-h-dvh items-center justify-center px-4 py-12" style={{ background: "var(--surface-sunken)", color: "var(--ink)" }}>
      <div className="w-full max-w-md rounded-[20px] border p-6 text-center sm:p-8" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
          <SearchX size={22} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-[22px] font-semibold" style={{ textWrap: "balance" }}>{t("rg.code.not_found")}</h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("rg.code.not_found_body")}</p>
        <form
          className="mt-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const c = value.trim();
            if (c) window.location.assign(`/join/${encodeURIComponent(c)}`);
          }}
        >
          <label htmlFor="join-code" className="sr-only">{t("rg.code.label")}</label>
          <input
            id="join-code"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            placeholder="HBTN2026"
            className="h-11 min-w-0 flex-1 rounded-[10px] border px-3 font-mono text-[14px] uppercase outline-none focus:ring-2"
            style={{ background: "var(--surface)", borderColor: "var(--line-strong)", color: "var(--ink)", ["--tw-ring-color" as string]: "var(--accent-weak)" }}
          />
          <button type="submit" disabled={!value.trim()} className="h-11 shrink-0 rounded-[10px] px-4 text-[14px] font-semibold text-white disabled:opacity-60" style={{ background: "var(--accent-solid)" }}>
            {t("rg.code.go")}
          </button>
        </form>
        <Link href="/" className="mt-5 inline-block text-[13px] hover:underline" style={{ color: "var(--ink-2)" }}>{t("rg.code.home")}</Link>
      </div>
    </main>
  );
}
