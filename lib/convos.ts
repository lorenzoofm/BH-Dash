// Convo Tracker: Cupid's conversation funnel next to Creatorstaq's real subs. Pure helpers, shared by
// app/api/convos and views/convos.

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
// Every day of a month up to and including today (UTC), oldest first.
export function monthDays(month: string, today: string) {
  const {start, last} = monthRange(month), out: string[] = [];
  for (let d = start; d <= last && d <= today; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) out.push(d);
  return out;
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

// Cupid gives a model a separate creator ID per platform. Stored in one field as "x:2290730,discord:2290729";
// a bare ID (saved before per-platform IDs) counts as the model's X creator.
export type CupidIds = Partial<Record<CupidApp, string>>;
export function cupidIds(value: unknown): CupidIds {
  const out: CupidIds = {};
  for (const part of String(value ?? "").split(/[,\s]+/).filter(Boolean)) {
    const [app, id] = part.includes(":") ? part.split(":", 2) : ["x", part];
    if ((CUPID_APPS as readonly string[]).includes(app) && id) out[app as CupidApp] = id;
  }
  return out;
}
export const formatCupidIds = (ids: CupidIds) => CUPID_APPS.filter(a => ids[a]).map(a => `${a}:${ids[a]}`).join(",");

// Creatorstaq sources folded into the Cupid apps, everything else as "other".
export const sourceBucket = (source: string): CupidApp | "other" => appOfSource(source) ?? "other";
// One CSV cell per value; quotes anything with a comma, quote or newline.
export const toCsv = (rows: (string | number | null | undefined)[][]) =>
  rows.map(r => r.map(v => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(",")).join("\n");

// Forecast from one daily series of convos used. Run rate = mean of the last 7 complete days (today is still
// filling in; fewer days early in the month, so it falls back to the month-to-date mean). This month = complete
// days + rate × days left (today included); next month = rate × its days.
export type Forecast = {actual: number; rate: number | null; basis: number; month: number | null; next: number | null};
export function forecast(days: {date: string; v: number | null | undefined}[], month: string, today: string): Forecast {
  const {last, next} = monthRange(month), dayCount = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
  const actual = days.reduce((a, d) => a + (d.v ?? 0), 0), done = days.filter(d => d.date < today && d.v != null);
  const window = done.slice(-7).map(d => d.v!), basis = window.length;
  const rate = basis ? window.reduce((a, x) => a + x, 0) / basis : null;
  const doneSum = done.reduce((a, d) => a + d.v!, 0), left = today > last ? 0 : dayCount(today < `${month}-01` ? `${month}-01` : today, last);
  const nextDays = dayCount(next, monthRange(next.slice(0, 7)).last);
  return {actual, rate, basis, month: rate == null ? null : Math.max(actual, doneSum + rate * left), next: rate == null ? null : rate * nextDays};
}

// Price per charged convo, by platform, or "all" for one flat price. Empty until pricing is agreed: every cost then
// reads "Set pricing". Plug prices in here and nowhere else.
export const CONVO_PRICE: Partial<Record<CupidApp | "all", number>> = {};
export function convoCost(convos: number | null | undefined, app?: CupidApp) {
  const price = (app && CONVO_PRICE[app]) ?? CONVO_PRICE.all;
  return price == null || convos == null ? null : convos * price;
}
