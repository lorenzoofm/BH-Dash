// Convo Tracker: Cupid's conversation funnel next to Creatorstaq's real subs. Pure helpers, shared by
// app/api/convos and views/convos.tsx.

// Cupid platforms the tracker reports on, in display order. Add any app from Cupid's list here.
export const CUPID_APPS = ["x", "discord", "instagram", "reddit", "threads"] as const;
export type CupidApp = typeof CUPID_APPS[number];
export const APP_LABEL: Record<CupidApp, string> = {x: "X", discord: "Discord", instagram: "Instagram", reddit: "Reddit", threads: "Threads"};

export type Funnel = {raw: number | null; charged: number | null; ctaStarted: number | null; ctaShared: number | null; ctaConversions: number | null; conversions: number | null};
const METRIC: Record<string, keyof Funnel> = {
  "conversations raw": "raw", "conversations charged": "charged", "cta phase started": "ctaStarted",
  "shared cta link": "ctaShared", "conversions from cta link shared": "ctaConversions", "conversions": "conversions",
};
// Cupid sends display strings like "900 (72.93% of 1,234)"; "-" means no denominator.
export function cupidCount(value: unknown): number | null {
  const m = String(value ?? "").match(/^\s*([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}
export function cupidMetrics(rows: {name: string; values: string[]}[]): Funnel {
  const out: Funnel = {raw: null, charged: null, ctaStarted: null, ctaShared: null, ctaConversions: null, conversions: null};
  for (const r of rows) { const k = METRIC[String(r.name).trim().toLowerCase()]; if (k) out[k] = cupidCount(r.values?.[0]); }
  return out;
}

// A UTC calendar month: first day, last day (Cupid's inclusive end) and the next month's first day
// (Creatorstaq's exclusive end).
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number), iso = (d: Date) => d.toISOString().slice(0, 10);
  return {start: `${month}-01`, last: iso(new Date(Date.UTC(y, m, 0))), next: iso(new Date(Date.UTC(y, m, 1)))};
}
export const shiftMonth = (month: string, by: number) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7); };

// Creatorstaq's first-touch source names, folded onto Cupid's app keys.
export function appOfSource(source: string): CupidApp | null {
  const s = source.toLowerCase().replace(/[^a-z]/g, "");
  if (s === "x" || s.startsWith("twitter")) return "x";
  if (s === "ig" || s.startsWith("instagram")) return "instagram";
  return (CUPID_APPS as readonly string[]).includes(s) ? s as CupidApp : null;
}
export const ratio = (a: number | null | undefined, b: number | null | undefined) => a != null && b ? a / b : null;
