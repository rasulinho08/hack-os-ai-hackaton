/**
 * A story's body: the text the owner writes, as the blocks the site shows.
 *
 * Two formats (showcase_posts.body_format):
 *   plain  the original: paragraphs split by blank lines, line breaks kept,
 *          nothing else means anything (every story written before the
 *          editor was rebuilt);
 *   rich   the same text plus a small markup the editor's toolbar writes:
 *            ## Heading            ### Smaller heading
 *            - item / * item       1. item
 *            > quote               ---  (a divider)
 *            ![caption](photo id)  an image: a photo uploaded to the story
 *            [text](https://…)     a link: http(s), mailto: or a path on the site
 *            **bold**              *italic* or _italic_
 *
 * Nothing here produces HTML: the result is data the page renders as React
 * elements, so a story can never inject markup. A link that goes anywhere
 * else (javascript:, data:…) stays text; the API refuses to save one anyway.
 * The editor's toolbar helpers (applyFormat) live here too, so what the
 * toolbar writes and what the page reads are defined in one place.
 */

export type BodyFormat = "plain" | "rich";

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { type: "h2" | "h3"; c: Inline[] }
  | { type: "p"; lines: Inline[][] }
  | { type: "quote"; lines: Inline[][] }
  | { type: "ul" | "ol"; items: Inline[][]; start?: number }
  | { type: "image"; ref: string; caption: string }
  | { type: "hr" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a link may go: the web, an e-mail address, or a page of the site. */
export function safeHref(href: string): string | null {
  const h = String(href || "").trim();
  if (/^\/(?!\/)/.test(h) || h.startsWith("#")) return h;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return h;
  try {
    const u = new URL(h);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The story photo an image points at: its id, from the id itself or its /api/files address. */
export function imageRef(target: string): string | null {
  const t = String(target || "").trim().replace(/^\/api\/files\//, "");
  return UUID.test(t) ? t.toLowerCase() : null;
}

/* ── Inline ────────────────────────────────────────────────────────────── */

const INLINE_RULES: { re: RegExp; make: (m: RegExpExecArray) => Inline }[] = [
  {
    re: /\[([^\]\n]+)\]\(([^)\s]*)\)/,
    make: (m) => {
      const href = safeHref(m[2]);
      return href ? { t: "link", href, c: parseInline(m[1]) } : { t: "text", v: m[1] };
    },
  },
  { re: /\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/, make: (m) => ({ t: "strong", c: parseInline(m[1]) }) },
  { re: /(?<![\w*])\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?![\w*])/, make: (m) => ({ t: "em", c: parseInline(m[1]) }) },
  { re: /(?<![\w_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![\w_])/, make: (m) => ({ t: "em", c: parseInline(m[1]) }) },
];

/** **bold**, *italic*, _italic_ and [links](…) inside one line; everything else is text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = String(text ?? "");
  while (rest) {
    let best: { index: number; length: number; node: Inline } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.index)) best = { index: m.index, length: m[0].length, node: rule.make(m) };
    }
    if (!best) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (best.index > 0) out.push({ t: "text", v: rest.slice(0, best.index) });
    out.push(best.node);
    rest = rest.slice(best.index + best.length);
  }
  // Neighbouring text pieces merge, so the output is stable to compare.
  return out.reduce<Inline[]>((acc, n) => {
    const last = acc[acc.length - 1];
    if (n.t === "text" && last && last.t === "text") acc[acc.length - 1] = { t: "text", v: last.v + n.v };
    else acc.push(n);
    return acc;
  }, []);
}

/** The words of inline content, without the markup (for alt text and summaries). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" ? n.v : inlineText(n.c))).join("");
}

/* ── Blocks ────────────────────────────────────────────────────────────── */

const H2 = /^##\s+(.+)$/;
const H3 = /^###\s+(.+)$/;
const HR = /^(-{3,}|\*{3,}|_{3,})$/;
const IMG = /^!\[([^\]\n]*)\]\(([^)\s]*)\)$/;
const UL = /^[-*•]\s+(.*)$/;
const OL = /^(\d{1,4})[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

const isBlockStart = (line: string) =>
  H2.test(line) || H3.test(line) || HR.test(line) || IMG.test(line) || UL.test(line) || OL.test(line) || QUOTE.test(line);

/** The original format: paragraphs split by blank lines, line breaks kept inside. */
function plainBlocks(text: string): Block[] {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ type: "p" as const, lines: p.split("\n").map((l) => [{ t: "text" as const, v: l }]) }));
}

function richBlocks(text: string): Block[] {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i += 1; continue; }
    let m: RegExpExecArray | null;
    if ((m = H3.exec(line))) { out.push({ type: "h3", c: parseInline(m[1].trim()) }); i += 1; continue; }
    if ((m = H2.exec(line))) { out.push({ type: "h2", c: parseInline(m[1].trim()) }); i += 1; continue; }
    if (HR.test(line)) { out.push({ type: "hr" }); i += 1; continue; }
    if ((m = IMG.exec(line))) {
      const ref = imageRef(m[2]);
      if (ref) out.push({ type: "image", ref, caption: m[1].trim() });
      i += 1;
      continue;
    }
    if (UL.test(line) || OL.test(line)) {
      const ordered = !UL.test(line);
      const items: Inline[][] = [];
      const start = ordered ? Number(OL.exec(line)![1]) : undefined;
      while (i < lines.length) {
        const l = lines[i].trim();
        const item = ordered ? OL.exec(l) : UL.exec(l);
        if (!item) break;
        items.push(parseInline((ordered ? item[2] : item[1]).trim()));
        i += 1;
      }
      out.push(ordered ? { type: "ol", items, ...(start && start !== 1 ? { start } : {}) } : { type: "ul", items });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: Inline[][] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i].trim());
        if (!q) break;
        quoted.push(parseInline(q[1]));
        i += 1;
      }
      out.push({ type: "quote", lines: quoted.filter((l, k) => l.length || k < quoted.length - 1) });
      continue;
    }
    const para: Inline[][] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i].trim())) {
      para.push(parseInline(lines[i].trim()));
      i += 1;
    }
    out.push({ type: "p", lines: para });
  }
  return out;
}

/** The blocks of a story's body in its format. */
export function parseBody(text: string, format: BodyFormat = "plain"): Block[] {
  return format === "rich" ? richBlocks(text) : plainBlocks(text);
}

/** The story photos the text shows as images (the editor warns before one is removed). */
export function imagesIn(text: string): string[] {
  return parseBody(text, "rich").flatMap((b) => (b.type === "image" ? [b.ref] : []));
}

/** Roughly how long the text takes to read, in minutes (at least 1). */
export function readingMinutes(text: string): number {
  const words = String(text || "").replace(/[#>*_[\]()!-]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/* ── The editor's toolbar ──────────────────────────────────────────────── */

export type FormatKind = "bold" | "italic" | "link" | "h2" | "h3" | "ul" | "ol" | "quote" | "hr" | "image";

export interface Edit {
  text: string;
  start: number;
  end: number;
}

const LINE_PREFIX: Partial<Record<FormatKind, (n: number) => string>> = {
  h2: () => "## ",
  h3: () => "### ",
  ul: () => "- ",
  ol: (n) => `${n}. `,
  quote: () => "> ",
};
const ANY_PREFIX = /^(#{2,3}\s+|[-*•]\s+|\d{1,4}[.)]\s+|>\s?)/;

/**
 * Apply one toolbar button to the text and selection: wrap the selection
 * (bold, italic, link), mark each selected line (headings, lists, quote —
 * pressing it again on marked lines takes the mark off), or insert a block
 * on its own line (divider, image). Answers the new text and selection.
 */
export function applyFormat(
  { text, start, end }: Edit,
  kind: FormatKind,
  arg: { href?: string; ref?: string; caption?: string } = {},
): Edit {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);

  if (kind === "bold" || kind === "italic") {
    const mark = kind === "bold" ? "**" : "*";
    if (before.endsWith(mark) && after.startsWith(mark) && !(kind === "italic" && before.endsWith("**") && after.startsWith("**"))) {
      return { text: before.slice(0, -mark.length) + selected + after.slice(mark.length), start: start - mark.length, end: end - mark.length };
    }
    const inner = selected || (kind === "bold" ? "bold text" : "italic text");
    return { text: `${before}${mark}${inner}${mark}${after}`, start: start + mark.length, end: start + mark.length + inner.length };
  }

  if (kind === "link") {
    const label = selected || "link text";
    const href = (arg.href || "https://").trim();
    const inserted = `[${label}](${href})`;
    return { text: before + inserted + after, start: start + 1, end: start + 1 + label.length };
  }

  if (kind === "hr" || kind === "image") {
    const block = kind === "hr" ? "---" : `![${(arg.caption || "").replace(/[[\]\n]/g, " ").replace(/\s+/g, " ").trim()}](${arg.ref || ""})`;
    const above = before.replace(/[ \t]+$/, "");
    const lead = above === "" ? "" : above.endsWith("\n\n") ? "" : above.endsWith("\n") ? "\n" : "\n\n";
    const rest = after.replace(/^\s+/, "");
    const head = above + lead + block + (rest ? "\n\n" : "\n");
    return { text: head + rest, start: head.length, end: head.length };
  }

  // Line marks: from the start of the first selected line to the end of the last.
  const lineStart = before.lastIndexOf("\n") + 1;
  const nl = text.indexOf("\n", Math.max(end - (end > start && text[end - 1] === "\n" ? 1 : 0), start));
  const lineEnd = nl === -1 ? text.length : nl;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const prefix = LINE_PREFIX[kind]!;
  const has = lines.filter((l) => l.trim()).every((l, i) => l.startsWith(prefix(i + 1)) || (kind === "ol" && /^\d{1,4}[.)]\s+/.test(l)));
  let n = 0;
  const next = lines
    .map((l) => {
      if (!l.trim()) return l;
      const bare = l.replace(ANY_PREFIX, "");
      if (has) return bare;
      n += 1;
      return prefix(n) + bare;
    })
    .join("\n");
  const out = text.slice(0, lineStart) + next + text.slice(lineEnd);
  return { text: out, start: lineStart, end: lineStart + next.length };
}
