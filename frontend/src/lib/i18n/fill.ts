/** Put values into a translated sentence: fill("Sent {n}", { n: 3 }) → "Sent 3". */
export function fill(text: string, vars: Record<string, string | number | null | undefined>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v == null ? "" : String(v));
  return out;
}
