"use client";

/**
 * One legal page (privacy, terms, cookies, refunds) in the reader's language:
 * a header with the date it was last changed, a list of its sections, the
 * sections themselves, and the operator's details under "Contact".
 *
 * Links carry their colour and underline inline: globals.css gives every
 * <a> its parent's colour and no underline, above any utility class.
 */

import { Fragment } from "react";
import Link from "next/link";
import { Eyebrow, Lead, SectionTitle } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import type { Lang } from "@/lib/i18n/types";
import { LEGAL_LINKS, LEGAL_OPERATOR, operatorLines, type LegalPageId } from "@/lib/legal";
import { LEGAL_DOCS, LEGAL_UI } from "./index";
import type { LegalBlock } from "./types";

const LINK_STYLE = {
  color: "var(--hs-brand)",
  textDecoration: "underline",
  textUnderlineOffset: 3,
} as const;

function EmailLink() {
  return (
    <a href={`mailto:${LEGAL_OPERATOR.email}`} style={{ ...LINK_STYLE, overflowWrap: "anywhere" }}>
      {LEGAL_OPERATOR.email}
    </a>
  );
}

/** Text with `{email}` shown as the contact address. */
function Rich({ text }: { text: string }) {
  const parts = text.split("{email}");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? <EmailLink /> : null}
        </Fragment>
      ))}
    </>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <>
      {/* A table from the small breakpoint up… */}
      <div className="hidden overflow-x-auto rounded-[var(--hs-radius)] border sm:block" style={{ borderColor: "var(--hs-line-2)" }}>
        <table className="w-full border-collapse text-left text-[14px] leading-relaxed">
          <thead>
            <tr style={{ background: "var(--hs-raised)" }}>
              {head.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.12em]"
                  style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink-3)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t align-top" style={{ borderColor: "var(--hs-line)" }}>
                {row.map((cell, i) => (
                  <td
                    key={i}
                    className={i === 0 ? "px-4 py-3 text-[13px] [overflow-wrap:anywhere]" : "px-4 py-3"}
                    style={i === 0
                      ? { fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink)", width: "28%" }
                      : { color: i === 1 ? "var(--hs-ink-2)" : "var(--hs-ink-3)", width: i === 2 ? "22%" : undefined }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* …and one card per row on a phone. */}
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li key={row[0]} className="rounded-[var(--hs-radius)] border p-4" style={{ borderColor: "var(--hs-line-2)" }}>
            <p className="text-[13px] [overflow-wrap:anywhere]" style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink)" }}>
              {row[0]}
            </p>
            <dl className="mt-2 space-y-1.5 text-[14px] leading-relaxed">
              {row.slice(1).map((cell, i) => (
                <div key={i}>
                  <dt className="sr-only">{head[i + 1]}</dt>
                  <dd style={{ color: i === 0 ? "var(--hs-ink-2)" : "var(--hs-ink-3)" }}>{cell}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "p") {
    return (
      <p>
        <Rich text={block.text} />
      </p>
    );
  }
  if (block.kind === "list") {
    return (
      <ul className="space-y-2.5">
        {block.items.map((item) => (
          <li key={item} className="flex gap-3">
            <span aria-hidden="true" className="mt-[11px] h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--hs-ink-3)" }} />
            <span className="min-w-0">
              <Rich text={item} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return <Table head={block.head} rows={block.rows} />;
}

function Operator({ lang }: { lang: Lang }) {
  return (
    <dl
      className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 rounded-[var(--hs-radius)] border p-5 text-[14px] sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)]"
      style={{ borderColor: "var(--hs-line-2)", background: "var(--hs-raised)" }}
    >
      {operatorLines(LEGAL_OPERATOR, lang).map((line) => (
        <Fragment key={line.key}>
          <dt style={{ color: "var(--hs-ink-3)" }}>{line.label}</dt>
          <dd className="min-w-0" style={{ color: "var(--hs-ink)" }}>
            {line.key === "email" ? <EmailLink /> : line.value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function LegalPage({ id }: { id: LegalPageId }) {
  const { lang } = useTranslation();
  const l: Lang = lang in LEGAL_DOCS[id] ? lang : "en";
  const doc = LEGAL_DOCS[id][l];
  const ui = LEGAL_UI[l];
  const others = LEGAL_LINKS.filter((link) => link.id !== id);

  return (
    <>
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-6xl px-5 pb-12 pt-14 sm:pt-20">
          <Eyebrow>{ui.eyebrow}</Eyebrow>
          <SectionTitle as="h1">{doc.title}</SectionTitle>
          <Lead>{doc.summary}</Lead>
          <p className="mt-6 text-[12.5px] uppercase tracking-[0.12em]" style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink-3)" }}>
            {ui.updated}: <time dateTime={LEGAL_OPERATOR.lastUpdated}>{doc.updated}</time>
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 py-12 sm:py-16 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label={ui.onThisPage} className="lg:sticky lg:top-28 lg:self-start">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em]" style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink-3)" }}>
            {ui.onThisPage}
          </p>
          <ol className="space-y-2 text-[14px] leading-snug">
            {doc.sections.map((s, i) => (
              <li key={s.id} className="flex gap-2">
                <span aria-hidden="true" style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink-3)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <a href={`#${s.id}`} className="min-w-0 hover:opacity-75" style={{ color: "var(--hs-ink-2)" }}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-w-0 max-w-[70ch]">
          {doc.sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="scroll-mt-28 border-t py-8 first:border-t-0 first:pt-0"
              style={{ borderColor: "var(--hs-line)" }}
            >
              <h2
                id={`${s.id}-title`}
                className="flex items-baseline gap-3 text-[20px] font-semibold leading-snug tracking-[-0.01em] sm:text-[22px]"
                style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}
              >
                <span aria-hidden="true" className="text-[13px] font-normal" style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink-3)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">{s.title}</span>
              </h2>
              <div className="mt-4 space-y-4 text-[15.5px] leading-[1.7]" style={{ color: "var(--hs-ink-2)" }}>
                {s.blocks.map((b, j) => (
                  <Block key={j} block={b} />
                ))}
                {s.operator ? <Operator lang={l} /> : null}
              </div>
            </section>
          ))}

          <div className="mt-4 border-t pt-8" style={{ borderColor: "var(--hs-line)" }}>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink-3)" }}>
              {ui.related}
            </p>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
              {others.map((link) => (
                <li key={link.id}>
                  <Link href={link.href} style={LINK_STYLE}>
                    {link.label[l]}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[14px]" style={{ color: "var(--hs-ink-3)" }}>
              {ui.questions} <EmailLink />
            </p>
          </div>
        </article>
      </div>
    </>
  );
}
